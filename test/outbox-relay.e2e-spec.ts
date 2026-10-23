import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { OutboxRelay, OutboxWriter } from '@modules/outbox';
import { AppConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { Queues } from '@shared/infrastructure/queue/queues';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

describe('OutboxRelay', () => {
  let db: DataSource;
  let uow: TypeOrmUnitOfWork;
  let queues: Queues;
  let writer: OutboxWriter;
  let relay: OutboxRelay;
  let queueName: string;

  beforeAll(async () => {
    const config = loadConfig(AppConfig, { ...testEnv(), JWT_SECRET: 'x'.repeat(32) });
    db = await new DataSource(dataSourceOptions(config)).initialize();
    uow = new TypeOrmUnitOfWork(db);
    queues = new Queues(config);
    writer = new OutboxWriter(uow);
  });

  afterAll(async () => {
    await queues.onApplicationShutdown();
    await db.destroy();
  });

  // A fresh queue per test, so no test sees another's jobs.
  beforeEach(async () => {
    await resetDatabase();
    queueName = `test-outbox-${randomUUID()}`;
    relay = new OutboxRelay(uow, queues);
  });

  afterEach(async () => {
    await relay.beforeApplicationShutdown();
    await queues.get(queueName).obliterate({ force: true });
  });

  const write = () =>
    uow.run(() =>
      writer.write({
        queue: queueName,
        type: 'ApplicationSubmitted',
        payload: { submissionNo: 1 },
      }),
    );
  const rows = () =>
    db.query<{ id: string; published_at: Date | null }[]>('SELECT id, published_at FROM outbox');
  const jobs = () => queues.get(queueName).getJobs(['waiting']);

  it('turns a committed row into one job whose id is the row id, and marks it published', async () => {
    await write();

    await expect(relay.relayBatch()).resolves.toBe(1);

    const [row] = await rows();
    expect(row?.published_at).toBeInstanceOf(Date);
    const [job] = await jobs();
    expect(job).toMatchObject({
      id: row?.id,
      name: 'ApplicationSubmitted',
      data: { submissionNo: 1 },
    });
    await expect(relay.relayBatch()).resolves.toBe(0);
  });

  it('relaying the same row again does not create a second job', async () => {
    await write();
    await relay.relayBatch();
    // As if the process died after add() but before its commit.
    await db.query('UPDATE outbox SET published_at = NULL');

    await expect(relay.relayBatch()).resolves.toBe(1);

    expect(await jobs()).toHaveLength(1);
  });

  it('never sees rows whose transaction has not committed', async () => {
    const pending = db.createQueryRunner();
    await pending.startTransaction();
    try {
      await pending.query(
        "INSERT INTO outbox (id, queue, type, payload) VALUES ($1, $2, 'ApplicationSubmitted', '{}')",
        [randomUUID(), queueName],
      );

      await expect(relay.relayBatch()).resolves.toBe(0);
    } finally {
      await pending.rollbackTransaction();
      await pending.release();
    }
    expect(await jobs()).toHaveLength(0);
  });

  it('skips rows another relay has locked instead of waiting or sending them twice', async () => {
    await write();
    const other = db.createQueryRunner();
    await other.startTransaction();
    try {
      await other.query('SELECT id FROM outbox FOR UPDATE');

      await expect(relay.relayBatch()).resolves.toBe(0);
    } finally {
      await other.rollbackTransaction();
      await other.release();
    }
    await expect(relay.relayBatch()).resolves.toBe(1);
  });

  it('once started, relays new rows in the background until shut down', async () => {
    relay.start();
    await write();

    for (let i = 0; i < 50 && (await jobs()).length === 0; i++) await sleep(100);

    expect(await jobs()).toHaveLength(1);
    const stopped = relay.beforeApplicationShutdown().then(() => 'stopped');
    await expect(Promise.race([stopped, sleep(3000, 'still running')])).resolves.toBe('stopped');
    await write();
    await sleep(1500);
    expect(await jobs()).toHaveLength(1);
  });
});
