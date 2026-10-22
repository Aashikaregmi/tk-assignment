import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  MerchantApplication,
  MerchantApplicationState,
} from '@modules/applications/domain/merchant-application';
import { OwnerContact } from '@modules/applications/domain/owner-contact';
import { ProcessingInfo } from '@modules/applications/domain/processing-info';
import { TypeOrmApplicationRepository } from '@modules/applications/infrastructure/typeorm-application.repository';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2g';

// Fake data only.
const details = {
  businessName: 'Example Coffee',
  legalBusinessName: 'Example Coffee LLC',
  businessType: 'LLC' as const,
  ownerContact: new OwnerContact({
    fullName: 'Jane Example',
    email: 'jane@example.com',
    phone: '+15550100123',
  }),
  processingInfo: new ProcessingInfo({
    monthlyVolumeCents: 2_500_000,
    averageTicketCents: 4_500,
    mcc: '5812',
  }),
};

describe('TypeOrmApplicationRepository', () => {
  let db: DataSource;
  let uow: TypeOrmUnitOfWork;
  let repository: TypeOrmApplicationRepository;
  let salesId: string;

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
    uow = new TypeOrmUnitOfWork(db);
    repository = new TypeOrmApplicationRepository(uow);
  });

  afterAll(() => db.destroy());

  beforeEach(async () => {
    await resetDatabase();
    const [user] = await db.query<{ id: string }[]>(
      "INSERT INTO users (email, password_hash, role) VALUES ('sales.one@example.com', $1, 'SALES') RETURNING id",
      [FAKE_HASH],
    );
    salesId = user!.id;
  });

  const newApplication = () => MerchantApplication.create(randomUUID(), salesId, details);
  const save = (application: MerchantApplication) => uow.run(() => repository.save(application));
  const load = (id: string) => uow.run(() => repository.findByIdForUpdate(id));

  it('round-trips an application, including value objects and bigint cents', async () => {
    const application = newApplication();

    await save(application);

    expect((await load(application.id))?.toState()).toEqual(application.toState());
  });

  it('persists changes to an existing application', async () => {
    const application = newApplication();
    await save(application);

    const loaded = (await load(application.id))!;
    loaded.submit();
    await save(loaded);

    expect((await load(application.id))?.toState()).toMatchObject({
      status: 'SUBMITTED',
      riskStatus: 'PENDING',
      submissionNo: 1,
    });
    const [timestamps] = await db.query<{ updated_after_create: boolean }[]>(
      'SELECT updated_at > created_at AS updated_after_create FROM merchant_applications',
    );
    expect(timestamps?.updated_after_create).toBe(true);
  });

  it('returns null for an unknown id', async () => {
    await expect(load(randomUUID())).resolves.toBeNull();
  });

  it('refuses to take a row lock outside a transaction', async () => {
    await expect(repository.findByIdForUpdate(randomUUID())).rejects.toThrow(
      /open transaction is required/,
    );
  });

  it('holds the row lock until the transaction ends', async () => {
    const application = newApplication();
    await save(application);
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let signalLocked = () => {};
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));

    const first = uow.run(async () => {
      const held = (await repository.findByIdForUpdate(application.id))!;
      signalLocked();
      await released;
      held.submit();
      await repository.save(held);
    });
    await locked;

    let secondLoaded = false;
    const second = uow.run(async () => {
      const seen = await repository.findByIdForUpdate(application.id);
      secondLoaded = true;
      return seen?.status;
    });

    try {
      await sleep(200);
      expect(secondLoaded).toBe(false);
    } finally {
      // Even on failure: an open transaction would block the next test's TRUNCATE.
      release();
    }
    await first;
    await expect(second).resolves.toBe('SUBMITTED');
  });

  // The domain normally prevents these; the database rejects them even if it is bypassed.
  it.each<[string, Partial<MerchantApplicationState>, RegExp]>([
    ['a draft with a submission', { submissionNo: 1 }, /merchant_applications_draft_check/],
    [
      'a submitted application never submitted',
      { status: 'SUBMITTED' },
      /merchant_applications_draft_check/,
    ],
    [
      'an average ticket above the monthly volume',
      {
        processingInfo: { monthlyVolumeCents: 100, averageTicketCents: 200, mcc: '5812' },
      },
      /merchant_applications_cents_check/,
    ],
    [
      'an unknown status',
      { status: 'ARCHIVED' as never, riskStatus: 'PENDING', submissionNo: 1 },
      /merchant_applications_status_check/,
    ],
    ['a creator who is not a user', { createdBy: randomUUID() }, /created_by_fkey/],
  ])('rejects %s at the database', async (_case, override, constraint) => {
    const forged = MerchantApplication.reconstitute({
      ...newApplication().toState(),
      ...override,
    });

    await expect(save(forged)).rejects.toThrow(constraint);
  });
});
