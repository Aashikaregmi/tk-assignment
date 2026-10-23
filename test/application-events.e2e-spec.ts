import {
  CreateApplicationCommand,
  CreateApplicationHandler,
} from '@modules/applications/application/create-application';
import { DomainEventPublisher } from '@modules/applications/application/domain-event-publisher';
import {
  SubmitApplicationCommand,
  SubmitApplicationHandler,
} from '@modules/applications/application/submit-application';
import {
  UpdateApplicationCommand,
  UpdateApplicationHandler,
} from '@modules/applications/application/update-application';
import { TransactionalEventPublisher } from '@modules/applications/infrastructure/transactional-event-publisher';
import { TypeOrmApplicationRepository } from '@modules/applications/infrastructure/typeorm-application.repository';
import { AuditWriter } from '@modules/audit';
import { OutboxWriter } from '@modules/outbox';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import type { Actor } from '@shared/domain/role';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2g';

// Fake data only.
const input = {
  businessName: 'Example Coffee',
  legalBusinessName: 'Example Coffee LLC',
  businessType: 'LLC' as const,
  ownerContact: { fullName: 'Jane Example', email: 'jane@example.com', phone: '+15550100123' },
  processingInfo: { monthlyVolumeCents: 2_500_000, averageTicketCents: 4_500, mcc: '5812' },
};

describe('application commands write audit and outbox rows in their transaction', () => {
  let db: DataSource;
  let uow: TypeOrmUnitOfWork;
  let repository: TypeOrmApplicationRepository;
  let publisher: TransactionalEventPublisher;
  let sales: Actor;

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
    uow = new TypeOrmUnitOfWork(db);
    repository = new TypeOrmApplicationRepository(uow);
    publisher = new TransactionalEventPublisher(new AuditWriter(uow), new OutboxWriter(uow));
  });

  afterAll(() => db.destroy());

  beforeEach(async () => {
    await resetDatabase();
    const [user] = await db.query<{ id: string }[]>(
      "INSERT INTO users (email, password_hash, role) VALUES ('sales.one@example.com', $1, 'SALES') RETURNING id",
      [FAKE_HASH],
    );
    sales = { id: user!.id, role: 'SALES' };
  });

  const create = () =>
    new CreateApplicationHandler(uow, repository, publisher).execute(
      new CreateApplicationCommand(sales, input),
    );
  const auditRows = () =>
    db.query<{ actor_id: string; action: string; entity_id: string; metadata: unknown }[]>(
      'SELECT actor_id, action, entity_id, metadata FROM audit_log ORDER BY id',
    );
  const outboxRows = () =>
    db.query<{ queue: string; type: string; payload: unknown; published_at: Date | null }[]>(
      'SELECT queue, type, payload, published_at FROM outbox ORDER BY created_at',
    );
  const status = async (id: string) =>
    (
      await db.query<{ status: string }[]>(
        'SELECT status FROM merchant_applications WHERE id = $1',
        [id],
      )
    )[0]?.status;

  it('writes one audit row per event, in order, with the acting user', async () => {
    const { id } = await create();
    await new UpdateApplicationHandler(uow, repository, publisher).execute(
      new UpdateApplicationCommand(sales, id, { businessName: 'Example Roasters' }),
    );
    await new SubmitApplicationHandler(uow, repository, publisher).execute(
      new SubmitApplicationCommand(sales, id),
    );

    expect(await auditRows()).toEqual([
      {
        actor_id: sales.id,
        action: 'ApplicationCreated',
        entity_id: id,
        metadata: { createdBy: sales.id },
      },
      {
        actor_id: sales.id,
        action: 'ApplicationUpdated',
        entity_id: id,
        metadata: { fields: ['businessName'] },
      },
      {
        actor_id: sales.id,
        action: 'ApplicationSubmitted',
        entity_id: id,
        metadata: { submissionNo: 1 },
      },
    ]);
  });

  it('queues a risk review for each submission, and nothing else', async () => {
    const { id } = await create();
    await new UpdateApplicationHandler(uow, repository, publisher).execute(
      new UpdateApplicationCommand(sales, id, { businessName: 'Example Roasters' }),
    );
    expect(await outboxRows()).toEqual([]);

    await new SubmitApplicationHandler(uow, repository, publisher).execute(
      new SubmitApplicationCommand(sales, id),
    );

    expect(await outboxRows()).toEqual([
      {
        queue: 'risk-review',
        type: 'ApplicationSubmitted',
        payload: { applicationId: id, submissionNo: 1 },
        published_at: null,
      },
    ]);
  });

  it('a command that fails after its writes leaves no audit row, no outbox row and no change', async () => {
    const { id } = await create();
    const failsAfterWrites: DomainEventPublisher = {
      publish: async (actorId, events) => {
        await publisher.publish(actorId, events);
        throw new Error('the transaction fails after the writes');
      },
    };

    await expect(
      new SubmitApplicationHandler(uow, repository, failsAfterWrites).execute(
        new SubmitApplicationCommand(sales, id),
      ),
    ).rejects.toThrow('the transaction fails after the writes');

    expect(await status(id)).toBe('DRAFT');
    expect((await auditRows()).map(({ action }) => action)).toEqual(['ApplicationCreated']);
    expect(await outboxRows()).toEqual([]);
  });
});
