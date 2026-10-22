import { UnitOfWork } from '@shared/application/unit-of-work';
import type { Actor } from '@shared/domain/role';
import {
  ApplicationAccessDenied,
  ApplicationNotEditable,
  ApplicationNotFound,
  InvalidApplicationData,
  InvalidStatusTransition,
} from '../domain/errors';
import { MerchantApplication, MerchantApplicationState } from '../domain/merchant-application';
import { ApplicationDetailsInput } from './application-input';
import { ApplicationRepository } from './application-repository';
import { CreateApplicationCommand, CreateApplicationHandler } from './create-application';
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
const ADMIN: Actor = { id: 'admin-1', role: 'ADMIN' };

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

  beforeEach(() => {
    uow = new FakeUnitOfWork();
    applications = new InMemoryApplications(uow);
    create = new CreateApplicationHandler(uow, applications);
    update = new UpdateApplicationHandler(uow, applications);
    submit = new SubmitApplicationHandler(uow, applications);
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
});
