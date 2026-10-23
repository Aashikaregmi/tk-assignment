import { randomUUID } from 'node:crypto';
import { AuditLogOrmEntity } from '@modules/audit/audit-log.orm-entity';
import { AuditWriter } from '@modules/audit/audit-writer';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { asOwner, dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

const CHANGES = [
  ['UPDATE', "UPDATE audit_log SET action = 'Forged'"],
  ['DELETE', 'DELETE FROM audit_log'],
];

describe('audit_log', () => {
  let app: DataSource;
  let owner: DataSource;

  beforeAll(async () => {
    app = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
    owner = await new DataSource({
      ...dataSourceOptions(loadConfig(DatabaseConfig, asOwner(testEnv()))),
      entities: [],
    }).initialize();
  });

  afterAll(async () => {
    await app.destroy();
    await owner.destroy();
  });

  beforeEach(() => resetDatabase());

  const append = () =>
    app.getRepository(AuditLogOrmEntity).save({
      actorId: randomUUID(),
      action: 'ApplicationUpdated',
      entityType: 'MerchantApplication',
      entityId: randomUUID(),
      metadata: { fields: ['businessName'] },
    });
  const actions = async () =>
    (await owner.query<{ action: string }[]>('SELECT action FROM audit_log')).map((r) => r.action);

  it('the app role appends and reads entries, in insertion order', async () => {
    const first = await append();
    const second = await append();

    const stored = await app.getRepository(AuditLogOrmEntity).findOneBy({ id: first.id });
    expect(stored).toMatchObject({
      actorId: first.actorId,
      action: 'ApplicationUpdated',
      entityType: 'MerchantApplication',
      entityId: first.entityId,
      metadata: { fields: ['businessName'] },
    });
    expect(stored?.occurredAt).toBeInstanceOf(Date);
    expect(BigInt(second.id)).toBeGreaterThan(BigInt(first.id));
  });

  it.each(CHANGES)('the app role cannot %s: permission denied', async (_change, sql) => {
    await append();

    await expect(app.query(sql)).rejects.toThrow(/permission denied for table audit_log/);
    expect(await actions()).toEqual(['ApplicationUpdated']);
  });

  it.each(CHANGES)('even the owner cannot %s: the trigger refuses', async (_change, sql) => {
    await append();

    await expect(owner.query(sql)).rejects.toThrow(/audit_log is append-only/);
    expect(await actions()).toEqual(['ApplicationUpdated']);
  });

  describe('AuditWriter', () => {
    let uow: TypeOrmUnitOfWork;
    let writer: AuditWriter;

    beforeAll(() => {
      uow = new TypeOrmUnitOfWork(app);
      writer = new AuditWriter(uow);
    });

    const entry = () => ({
      actorId: randomUUID(),
      action: 'ApplicationCreated',
      entityType: 'MerchantApplication',
      entityId: randomUUID(),
      // Fake data only.
      metadata: { ownerEmail: 'jane@example.com' },
    });

    it('stores the entry with masked metadata', async () => {
      await uow.run(() => writer.write(entry()));

      const [stored] = await app.getRepository(AuditLogOrmEntity).find();
      expect(stored?.metadata).toEqual({ ownerEmail: 'j***@example.com' });
    });

    it('joins the unit of work: rolled back with it', async () => {
      await expect(
        uow.run(async () => {
          await writer.write(entry());
          throw new Error('the change failed');
        }),
      ).rejects.toThrow('the change failed');

      expect(await actions()).toEqual([]);
    });
  });
});
