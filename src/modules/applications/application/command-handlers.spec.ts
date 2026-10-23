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
import type { ApplicationEvent } from '../domain/events';
import { MerchantApplication, MerchantApplicationState } from '../domain/merchant-application';
import { ApplicationDetailsInput } from './application-input';
import { ApplicationRepository } from './application-repository';
import { AssignReviewerCommand, AssignReviewerHandler } from './assign-reviewer';
import { CreateApplicationCommand, CreateApplicationHandler } from './create-application';
import { DomainEventPublisher } from './domain-event-publisher';
import { FailRiskReviewCommand, FailRiskReviewHandler } from './fail-risk-review';
import { ProcessRiskReviewCommand, ProcessRiskReviewHandler } from './process-risk-review';
import { RecordDecisionCommand, RecordDecisionHandler } from './record-decision';
import { ReviewerDirectory } from './reviewer-directory';
import { RiskAssessmentRequest, RiskProvider } from './risk-provider';
import { RiskReview, RiskReviewRepository } from './risk-review-repository';
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

  findById(id: string): Promise<MerchantApplication | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? MerchantApplication.reconstitute(row) : null);
  }

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

// Records what would be written; like the repository, only inside a unit of work.
class RecordingPublisher implements DomainEventPublisher {
  readonly published: { actorId: string | null; type: string }[] = [];

  constructor(private readonly uow: FakeUnitOfWork) {}

  publish(actorId: string | null, events: readonly ApplicationEvent[]): Promise<void> {
    if (!this.uow.active) throw new Error('publish outside a unit of work');
    this.published.push(...events.map(({ type }) => ({ actorId, type })));
    return Promise.resolve();
  }
}

// Refuses to run inside a unit of work: no row lock may be held while a third party responds.
class FakeRiskProvider implements RiskProvider {
  readonly calls: { request: RiskAssessmentRequest; key: string }[] = [];
  // Runs during the call, to simulate something happening meanwhile.
  duringCall = () => {};

  constructor(private readonly uow: FakeUnitOfWork) {}

  assess(request: RiskAssessmentRequest, key: string) {
    if (this.uow.active) throw new Error('provider called inside a unit of work');
    this.calls.push({ request, key });
    this.duringCall();
    return Promise.resolve({ result: 'MEDIUM' as const, score: 55 });
  }
}

// Like the database: only inside a unit of work, and one review per submission.
class InMemoryRiskReviews implements RiskReviewRepository {
  readonly rows: RiskReview[] = [];

  constructor(private readonly uow: FakeUnitOfWork) {}

  add(review: RiskReview): Promise<void> {
    if (!this.uow.active) throw new Error('review added outside a unit of work');
    const { applicationId, submissionNo } = review;
    if (
      this.rows.some((r) => r.applicationId === applicationId && r.submissionNo === submissionNo)
    ) {
      throw new Error('duplicate review for this submission');
    }
    this.rows.push(review);
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
  let events: RecordingPublisher;
  let create: CreateApplicationHandler;
  let update: UpdateApplicationHandler;
  let submit: SubmitApplicationHandler;
  let assign: AssignReviewerHandler;
  let decide: RecordDecisionHandler;

  beforeEach(() => {
    uow = new FakeUnitOfWork();
    applications = new InMemoryApplications(uow);
    events = new RecordingPublisher(uow);
    create = new CreateApplicationHandler(uow, applications, events);
    update = new UpdateApplicationHandler(uow, applications, events);
    submit = new SubmitApplicationHandler(uow, applications, events);
    assign = new AssignReviewerHandler(uow, applications, reviewers, events);
    decide = new RecordDecisionHandler(uow, applications, events);
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

  describe('events', () => {
    it('every command publishes its events with the acting user', async () => {
      const id = await createAs(SALES_A);
      await update.execute(new UpdateApplicationCommand(SALES_A, id, { businessName: 'Renamed' }));
      await submit.execute(new SubmitApplicationCommand(SALES_A, id));
      await assign.execute(new AssignReviewerCommand(ADMIN, id, REVIEWER.id));
      applications.rows.set(id, { ...stored(id)!, riskStatus: 'LOW' });
      await decide.execute(new RecordDecisionCommand(REVIEWER, id, 'APPROVE'));

      expect(events.published).toEqual([
        { actorId: SALES_A.id, type: 'ApplicationCreated' },
        { actorId: SALES_A.id, type: 'ApplicationUpdated' },
        { actorId: SALES_A.id, type: 'ApplicationSubmitted' },
        { actorId: ADMIN.id, type: 'ReviewerAssigned' },
        { actorId: REVIEWER.id, type: 'ApplicationDecided' },
      ]);
    });

    it('a refused command publishes nothing', async () => {
      const id = await createAs(SALES_A);
      events.published.length = 0;

      await expect(
        update.execute(new UpdateApplicationCommand(SALES_B, id, { businessName: 'Hijacked' })),
      ).rejects.toThrow(ApplicationNotFound);
      await expect(submit.execute(new SubmitApplicationCommand(REVIEWER, id))).rejects.toThrow(
        ApplicationNotFound,
      );

      expect(events.published).toEqual([]);
    });
  });

  describe('process risk review', () => {
    let provider: FakeRiskProvider;
    let reviews: InMemoryRiskReviews;
    let review: ProcessRiskReviewHandler;
    let fail: FailRiskReviewHandler;

    beforeEach(() => {
      provider = new FakeRiskProvider(uow);
      reviews = new InMemoryRiskReviews(uow);
      review = new ProcessRiskReviewHandler(uow, applications, provider, reviews, events);
      fail = new FailRiskReviewHandler(uow, applications, reviews, events);
    });

    const submitted = async () => {
      const id = await createAs(SALES_A);
      await submit.execute(new SubmitApplicationCommand(SALES_A, id));
      events.published.length = 0;
      return id;
    };

    it('asks the provider once, outside the transaction, and records its result as the system', async () => {
      const id = await submitted();

      await review.execute(new ProcessRiskReviewCommand(id, 1));

      expect(provider.calls).toEqual([
        {
          key: `${id}:1`,
          request: {
            legalBusinessName: 'Example Coffee LLC',
            businessType: 'LLC',
            monthlyVolumeCents: 2_500_000,
            averageTicketCents: 4_500,
            mcc: '5812',
          },
        },
      ]);
      expect(stored(id)?.riskStatus).toBe('MEDIUM');
      expect(reviews.rows).toEqual([
        { applicationId: id, submissionNo: 1, result: 'MEDIUM', score: 55 },
      ]);
      expect(events.published).toEqual([{ actorId: null, type: 'RiskReviewCompleted' }]);
    });

    it('a duplicate delivery changes nothing and does not call the provider again', async () => {
      const id = await submitted();
      await review.execute(new ProcessRiskReviewCommand(id, 1));

      await review.execute(new ProcessRiskReviewCommand(id, 1));

      expect(provider.calls).toHaveLength(1);
      expect(reviews.rows).toHaveLength(1);
      expect(events.published).toHaveLength(1);
    });

    it('a job for an older submission is skipped without calling the provider', async () => {
      const id = await submitted();
      applications.rows.set(id, { ...stored(id)!, submissionNo: 2 });

      await review.execute(new ProcessRiskReviewCommand(id, 1));

      expect(provider.calls).toHaveLength(0);
      expect(stored(id)?.riskStatus).toBe('PENDING');
    });

    it('a job for an unknown application is skipped', async () => {
      await expect(
        review.execute(new ProcessRiskReviewCommand('00000000-0000-4000-8000-000000000000', 1)),
      ).resolves.toBeUndefined();
      expect(provider.calls).toHaveLength(0);
    });

    it('drops the result if the application was resubmitted during the provider call', async () => {
      const id = await submitted();
      provider.duringCall = () => applications.rows.set(id, { ...stored(id)!, submissionNo: 2 });

      await review.execute(new ProcessRiskReviewCommand(id, 1));

      expect(stored(id)).toMatchObject({ riskStatus: 'PENDING', submissionNo: 2 });
      expect(reviews.rows).toEqual([]);
      expect(events.published).toEqual([]);
    });

    it('marks the review FAILED once retries are exhausted, as the system', async () => {
      const id = await submitted();

      await fail.execute(new FailRiskReviewCommand(id, 1));

      expect(stored(id)?.riskStatus).toBe('FAILED');
      expect(reviews.rows).toEqual([
        { applicationId: id, submissionNo: 1, result: 'FAILED', score: null },
      ]);
      expect(events.published).toEqual([{ actorId: null, type: 'RiskReviewFailed' }]);
    });

    it('a late failure after the result changes nothing', async () => {
      const id = await submitted();
      await review.execute(new ProcessRiskReviewCommand(id, 1));

      await fail.execute(new FailRiskReviewCommand(id, 1));

      expect(stored(id)?.riskStatus).toBe('MEDIUM');
      expect(reviews.rows).toHaveLength(1);
    });
  });
});
