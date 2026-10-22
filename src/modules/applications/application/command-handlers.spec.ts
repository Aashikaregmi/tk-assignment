import { UnitOfWork } from '@shared/application/unit-of-work';
import type { Actor } from '@shared/domain/role';
import {
  ApplicationAccessDenied,
  ApplicationNotEditable,
  ApplicationNotAssignable,
  ApplicationNotFound,
  InvalidApplicationData,
  InvalidReviewer,
  InvalidStatusTransition,
  NotAssignedReviewer,
} from '../domain/errors';
import { MerchantApplication, MerchantApplicationState } from '../domain/merchant-application';
import { ApplicationDetailsInput } from './application-input';
import { ApplicationRepository } from './application-repository';
import { AssignReviewerCommand, AssignReviewerHandler } from './assign-reviewer';
import { CreateApplicationCommand, CreateApplicationHandler } from './create-application';
import { RecordDecisionCommand, RecordDecisionHandler } from './record-decision';
import { ReviewerDirectory } from './reviewer-directory';
import { SubmitApplicationCommand, SubmitApplicationHandler } from './submit-application';
import { UpdateApplicationCommand, UpdateApplicationHandler } from './update-application';

class FakeUnitOfWork implements UnitOfWork {
  active = false;

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.active = true;
    try {
      return await work();
    } finally {
      this.active = false;
    }
  }
}

// Stores state, not instances, so every load is a fresh aggregate, like a database read.
class InMemoryApplications implements ApplicationRepository {
  readonly rows = new Map<string, MerchantApplicationState>();

  constructor(private readonly uow: FakeUnitOfWork) {}

  findByIdForUpdate(id: string): Promise<MerchantApplication | null> {
    if (!this.uow.active) throw new Error('row lock taken outside a unit of work');
    const row = this.rows.get(id);
    return Promise.resolve(row ? MerchantApplication.reconstitute(row) : null);
  }

  save(application: MerchantApplication): Promise<void> {
    if (!this.uow.active) throw new Error('save outside a unit of work');
    this.rows.set(application.id, application.toState());
    return Promise.resolve();
  }
}

const SALES_A: Actor = { id: 'sales-a', role: 'SALES' };
const SALES_B: Actor = { id: 'sales-b', role: 'SALES' };
const REVIEWER: Actor = { id: 'reviewer-1', role: 'REVIEWER' };
const OTHER_REVIEWER: Actor = { id: 'reviewer-2', role: 'REVIEWER' };
const ADMIN: Actor = { id: 'admin-1', role: 'ADMIN' };

const reviewers: ReviewerDirectory = {
  isReviewer: (userId) => Promise.resolve([REVIEWER.id, OTHER_REVIEWER.id].includes(userId)),
};

// Fake data only.
const input: ApplicationDetailsInput = {
  businessName: 'Example Coffee',
  legalBusinessName: 'Example Coffee LLC',
  businessType: 'LLC',
  ownerContact: { fullName: 'Jane Example', email: 'jane@example.com', phone: '+15550100123' },
  processingInfo: { monthlyVolumeCents: 2_500_000, averageTicketCents: 4_500, mcc: '5812' },
};

describe('application command handlers', () => {
  let uow: FakeUnitOfWork;
  let applications: InMemoryApplications;
  let create: CreateApplicationHandler;
  let update: UpdateApplicationHandler;
  let submit: SubmitApplicationHandler;
  let assign: AssignReviewerHandler;
  let decide: RecordDecisionHandler;

  beforeEach(() => {
    uow = new FakeUnitOfWork();
    applications = new InMemoryApplications(uow);
    create = new CreateApplicationHandler(uow, applications);
    update = new UpdateApplicationHandler(uow, applications);
    submit = new SubmitApplicationHandler(uow, applications);
    assign = new AssignReviewerHandler(uow, applications, reviewers);
    decide = new RecordDecisionHandler(uow, applications);
  });

  const createAs = async (actor: Actor) =>
    (await create.execute(new CreateApplicationCommand(actor, input))).id;
  const stored = (id: string) => applications.rows.get(id);

  describe('create', () => {
    it.each([SALES_A, ADMIN])('lets $role create a DRAFT owned by them', async (actor) => {
      const id = await createAs(actor);

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(stored(id)).toMatchObject({ createdBy: actor.id, status: 'DRAFT', submissionNo: 0 });
    });

    it('refuses REVIEWER', async () => {
      await expect(createAs(REVIEWER)).rejects.toThrow(ApplicationAccessDenied);
      expect(applications.rows.size).toBe(0);
    });

    it('rejects invalid details before storing anything', async () => {
      const badPhone = { ...input, ownerContact: { ...input.ownerContact, phone: '555-0100' } };
      await expect(create.execute(new CreateApplicationCommand(SALES_A, badPhone))).rejects.toThrow(
        InvalidApplicationData,
      );
      expect(applications.rows.size).toBe(0);
    });
  });

  describe('update', () => {
    it('applies the owner’s changes, replacing nested objects whole', async () => {
      const id = await createAs(SALES_A);
      const processingInfo = {
        monthlyVolumeCents: 900_000,
        averageTicketCents: 1_200,
        mcc: '5411',
      };

      await update.execute(
        new UpdateApplicationCommand(SALES_A, id, {
          businessName: 'Example Roasters',
          processingInfo,
        }),
      );

      expect(stored(id)).toMatchObject({ businessName: 'Example Roasters', processingInfo });
    });

    it('lets ADMIN edit another user’s application', async () => {
      const id = await createAs(SALES_A);
      await update.execute(new UpdateApplicationCommand(ADMIN, id, { businessName: 'Renamed' }));
      expect(stored(id)?.businessName).toBe('Renamed');
    });

    it.each<[string, Actor, string]>([
      ['another SALES user', SALES_B, 'existing'],
      ['an unknown id', SALES_A, 'missing'],
    ])('answers not found for %s and changes nothing', async (_case, actor, which) => {
      const id = await createAs(SALES_A);
      const target = which === 'existing' ? id : '00000000-0000-4000-8000-000000000000';

      await expect(
        update.execute(new UpdateApplicationCommand(actor, target, { businessName: 'Hijacked' })),
      ).rejects.toThrow(ApplicationNotFound);
      expect(stored(id)?.businessName).toBe('Example Coffee');
    });

    it('refuses REVIEWER on an application it can see', async () => {
      const id = await createAs(SALES_A);
      await submit.execute(new SubmitApplicationCommand(SALES_A, id));

      await expect(
        update.execute(new UpdateApplicationCommand(REVIEWER, id, { businessName: 'Changed' })),
      ).rejects.toThrow(ApplicationAccessDenied);
    });

    it('refuses edits after submission', async () => {
      const id = await createAs(SALES_A);
      await submit.execute(new SubmitApplicationCommand(SALES_A, id));

      await expect(
        update.execute(new UpdateApplicationCommand(SALES_A, id, { businessName: 'Changed' })),
      ).rejects.toThrow(ApplicationNotEditable);
    });
  });

  describe('submit', () => {
    it('submits the owner’s draft and starts a risk review', async () => {
      const id = await createAs(SALES_A);

      await submit.execute(new SubmitApplicationCommand(SALES_A, id));

      expect(stored(id)).toMatchObject({
        status: 'SUBMITTED',
        riskStatus: 'PENDING',
        submissionNo: 1,
      });
    });

    it('answers not found to another SALES user and changes nothing', async () => {
      const id = await createAs(SALES_A);

      await expect(submit.execute(new SubmitApplicationCommand(SALES_B, id))).rejects.toThrow(
        ApplicationNotFound,
      );
      expect(stored(id)?.status).toBe('DRAFT');
    });

    it('refuses a second submission', async () => {
      const id = await createAs(SALES_A);
      await submit.execute(new SubmitApplicationCommand(SALES_A, id));

      await expect(submit.execute(new SubmitApplicationCommand(SALES_A, id))).rejects.toThrow(
        InvalidStatusTransition,
      );
      expect(stored(id)?.submissionNo).toBe(1);
    });
  });

  describe('assign reviewer', () => {
    const submitted = async () => {
      const id = await createAs(SALES_A);
      await submit.execute(new SubmitApplicationCommand(SALES_A, id));
      return id;
    };

    it('lets ADMIN assign a reviewer', async () => {
      const id = await submitted();

      await assign.execute(new AssignReviewerCommand(ADMIN, id, REVIEWER.id));

      expect(stored(id)?.assignedReviewerId).toBe(REVIEWER.id);
    });

    it.each([
      ['a SALES user', SALES_A.id],
      ['an ADMIN', ADMIN.id],
      ['an unknown user', '00000000-0000-4000-8000-000000000000'],
    ])('refuses %s as the reviewer', async (_case, target) => {
      const id = await submitted();

      await expect(assign.execute(new AssignReviewerCommand(ADMIN, id, target))).rejects.toThrow(
        InvalidReviewer,
      );
      expect(stored(id)?.assignedReviewerId).toBeNull();
    });

    it.each<[string, Actor, typeof ApplicationAccessDenied | typeof ApplicationNotFound]>([
      ['the SALES owner', SALES_A, ApplicationAccessDenied],
      ['another SALES user', SALES_B, ApplicationNotFound],
      ['a REVIEWER assigning themselves', REVIEWER, ApplicationAccessDenied],
    ])('refuses %s', async (_case, actor, error) => {
      const id = await submitted();

      await expect(
        assign.execute(new AssignReviewerCommand(actor, id, REVIEWER.id)),
      ).rejects.toThrow(error);
      expect(stored(id)?.assignedReviewerId).toBeNull();
    });

    it('refuses a draft', async () => {
      const id = await createAs(SALES_A);
      await expect(
        assign.execute(new AssignReviewerCommand(ADMIN, id, REVIEWER.id)),
      ).rejects.toThrow(ApplicationNotAssignable);
    });
  });

  describe('record decision', () => {
    // Submitted, assigned to REVIEWER, risk result in (the worker's job, from E10).
    const awaitingDecision = async () => {
      const id = await createAs(SALES_A);
      await submit.execute(new SubmitApplicationCommand(SALES_A, id));
      await assign.execute(new AssignReviewerCommand(ADMIN, id, REVIEWER.id));
      applications.rows.set(id, { ...stored(id)!, riskStatus: 'LOW' });
      return id;
    };

    it('records the assigned reviewer’s decision', async () => {
      const id = await awaitingDecision();

      await decide.execute(new RecordDecisionCommand(REVIEWER, id, 'REJECT', 'MCC not supported'));

      expect(stored(id)).toMatchObject({
        status: 'REJECTED',
        decisionReason: 'MCC not supported',
      });
    });

    it.each<[string, Actor, typeof NotAssignedReviewer | typeof ApplicationNotFound]>([
      ['a reviewer who is not assigned', OTHER_REVIEWER, NotAssignedReviewer],
      ['ADMIN', ADMIN, NotAssignedReviewer],
      ['the SALES owner', SALES_A, NotAssignedReviewer],
      ['another SALES user', SALES_B, ApplicationNotFound],
    ])('refuses %s and changes nothing', async (_case, actor, error) => {
      const id = await awaitingDecision();

      await expect(decide.execute(new RecordDecisionCommand(actor, id, 'APPROVE'))).rejects.toThrow(
        error,
      );
      expect(stored(id)?.status).toBe('SUBMITTED');
    });

    it('answers not found to a reviewer for a draft', async () => {
      const id = await createAs(SALES_A);
      await expect(
        decide.execute(new RecordDecisionCommand(REVIEWER, id, 'APPROVE')),
      ).rejects.toThrow(ApplicationNotFound);
    });
  });
});
