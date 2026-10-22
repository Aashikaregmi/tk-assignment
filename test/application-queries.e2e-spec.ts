import { randomUUID } from 'node:crypto';
import {
  GetApplicationQuery,
  ListApplicationsQuery,
} from '@modules/applications/application/application-queries';
import { canRead } from '@modules/applications/domain/access-policy';
import { ApplicationNotFound } from '@modules/applications/domain/errors';
import { MerchantApplication } from '@modules/applications/domain/merchant-application';
import { OwnerContact } from '@modules/applications/domain/owner-contact';
import { ProcessingInfo } from '@modules/applications/domain/processing-info';
import {
  GetApplicationHandler,
  ListApplicationsHandler,
} from '@modules/applications/infrastructure/application-query-handlers';
import { TypeOrmApplicationRepository } from '@modules/applications/infrastructure/typeorm-application.repository';
import type { Actor, Role } from '@shared/domain/role';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2g';

// Fake data only.
const details = (businessName: string) => ({
  businessName,
  legalBusinessName: `${businessName} LLC`,
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
});

describe('application queries', () => {
  let db: DataSource;
  let getHandler: GetApplicationHandler;
  let listHandler: ListApplicationsHandler;
  const actors = {} as Record<'salesA' | 'salesB' | 'reviewer' | 'admin', Actor>;
  // Oldest first: A draft, A submitted, B draft, B submitted.
  const apps: MerchantApplication[] = [];

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
    const uow = new TypeOrmUnitOfWork(db);
    const repository = new TypeOrmApplicationRepository(uow);
    getHandler = new GetApplicationHandler(uow);
    listHandler = new ListApplicationsHandler(uow);

    await resetDatabase();
    const users: [keyof typeof actors, string, Role][] = [
      ['salesA', 'sales.one@example.com', 'SALES'],
      ['salesB', 'sales.two@example.com', 'SALES'],
      ['reviewer', 'reviewer.one@example.com', 'REVIEWER'],
      ['admin', 'admin@example.com', 'ADMIN'],
    ];
    for (const [key, email, role] of users) {
      const [row] = await db.query<{ id: string }[]>(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
        [email, FAKE_HASH, role],
      );
      actors[key] = { id: row!.id, role };
    }

    for (const [owner, submitted] of [
      [actors.salesA, false],
      [actors.salesA, true],
      [actors.salesB, false],
      [actors.salesB, true],
    ] as const) {
      const application = MerchantApplication.create(
        randomUUID(),
        owner.id,
        details(`Shop ${apps.length + 1}`),
      );
      if (submitted) application.submit();
      await uow.run(() => repository.save(application));
      apps.push(application);
    }
  });

  afterAll(() => db.destroy());

  const list = (actor: Actor, filter: Partial<ListApplicationsQuery['filter']> = {}) =>
    listHandler.execute(new ListApplicationsQuery(actor, { page: 1, limit: 20, ...filter }));
  const idsOf = (indexes: number[]) => indexes.map((i) => apps[i]!.id);

  it.each<[string, keyof typeof actors, number[]]>([
    ['SALES sees only their own', 'salesA', [1, 0]],
    ['another SALES user sees only theirs', 'salesB', [3, 2]],
    ['REVIEWER sees everything but drafts', 'reviewer', [3, 1]],
    ['ADMIN sees everything', 'admin', [3, 2, 1, 0]],
  ])('list: %s, newest first', async (_case, actor, expected) => {
    const page = await list(actors[actor]);

    expect(page.items.map(({ id }) => id)).toEqual(idsOf(expected));
    expect(page.total).toBe(expected.length);
  });

  it('filters by status within the scope', async () => {
    const drafts = await list(actors.admin, { status: 'DRAFT' });
    expect(drafts.items.map(({ id }) => id)).toEqual(idsOf([2, 0]));

    const salesDrafts = await list(actors.salesA, { status: 'DRAFT' });
    expect(salesDrafts.items.map(({ id }) => id)).toEqual(idsOf([0]));
  });

  it('paginates with a stable order and the total across pages', async () => {
    const first = await list(actors.admin, { limit: 3, page: 1 });
    const second = await list(actors.admin, { limit: 3, page: 2 });

    expect(first).toMatchObject({ total: 4, page: 1, limit: 3 });
    expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(idsOf([3, 2, 1, 0]));
  });

  it('caps the page size at 100', async () => {
    await expect(list(actors.admin, { limit: 10_000 })).resolves.toMatchObject({ limit: 100 });
  });

  it('returns the full view, with cents as numbers', async () => {
    const view = await getHandler.execute(new GetApplicationQuery(actors.salesA, apps[0]!.id));

    expect(view).toMatchObject({
      id: apps[0]!.id,
      businessName: 'Shop 1',
      ownerContact: { fullName: 'Jane Example', email: 'jane@example.com' },
      processingInfo: { monthlyVolumeCents: 2_500_000, averageTicketCents: 4_500, mcc: '5812' },
      status: 'DRAFT',
      riskStatus: 'NOT_STARTED',
      createdBy: actors.salesA.id,
      assignedReviewerId: null,
    });
    expect(view.createdAt).toBeInstanceOf(Date);
  });

  it('answers not found for an unknown id', async () => {
    await expect(
      getHandler.execute(new GetApplicationQuery(actors.admin, randomUUID())),
    ).rejects.toThrow(ApplicationNotFound);
  });

  // The SQL scope and the in-memory policy must agree for every actor and application.
  it('agrees with the access policy for every actor and application', async () => {
    for (const actor of Object.values(actors)) {
      for (const application of apps) {
        const visible = await getHandler
          .execute(new GetApplicationQuery(actor, application.id))
          .then(
            () => true,
            (error: unknown) => {
              if (error instanceof ApplicationNotFound) return false;
              throw error;
            },
          );
        expect({ actor: actor.role, app: application.id, visible }).toEqual({
          actor: actor.role,
          app: application.id,
          visible: canRead(actor, application),
        });
      }
    }
  });
});
