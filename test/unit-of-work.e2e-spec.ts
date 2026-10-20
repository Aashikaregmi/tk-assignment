import { loadConfig } from '@shared/infrastructure/config/app-config';
import { asOwner, dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { DataSource } from 'typeorm';
import { testEnv } from './test-env';

describe('TypeOrmUnitOfWork', () => {
  let owner: DataSource;
  let db: DataSource;
  let uow: TypeOrmUnitOfWork;

  beforeAll(async () => {
    owner = await new DataSource(dataSourceOptions(loadConfig(asOwner(testEnv())))).initialize();
    await owner.query('CREATE TABLE IF NOT EXISTS uow_probe (value text NOT NULL)');
    db = await new DataSource(dataSourceOptions(loadConfig(testEnv()))).initialize();
    uow = new TypeOrmUnitOfWork(db);
  });

  afterAll(async () => {
    await db.destroy();
    await owner.query('DROP TABLE uow_probe');
    await owner.destroy();
  });

  beforeEach(() => db.query('DELETE FROM uow_probe'));

  const insert = (value: string) =>
    uow.manager.query('INSERT INTO uow_probe (value) VALUES ($1)', [value]);

  const committed = async () =>
    (await db.query<{ value: string }[]>('SELECT value FROM uow_probe ORDER BY value')).map(
      (row) => row.value,
    );

  const transactionId = async () =>
    (await uow.manager.query<{ id: string }[]>('SELECT txid_current()::text AS id'))[0]?.id;

  it('commits when the work resolves', async () => {
    await expect(uow.run(() => insert('a').then(() => 'result'))).resolves.toBe('result');
    expect(await committed()).toEqual(['a']);
  });

  it('rolls back and rethrows when the work throws', async () => {
    const failure = new Error('boom');
    await expect(
      uow.run(async () => {
        await insert('a');
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await committed()).toEqual([]);
  });

  it('joins the outer transaction from a nested run', async () => {
    await expect(
      uow.run(async () => {
        const outer = await transactionId();
        await insert('a');
        const inner = await uow.run(async () => {
          await insert('b');
          return transactionId();
        });
        expect(inner).toBe(outer);
        throw new Error('outer fails after inner succeeded');
      }),
    ).rejects.toThrow('outer fails');
    expect(await committed()).toEqual([]);
  });

  it('keeps concurrent runs in separate transactions', async () => {
    // Both runs are inside their transactions before either reads again.
    let waiting = 2;
    let release = () => {};
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    const work = async () => {
      const before = await transactionId();
      if (--waiting === 0) release();
      await bothStarted;
      return [before, await transactionId()];
    };

    const [first, second] = await Promise.all([uow.run(work), uow.run(work)]);

    expect(first?.[0]).toBe(first?.[1]);
    expect(second?.[0]).toBe(second?.[1]);
    expect(first?.[0]).not.toBe(second?.[0]);
  });

  it('uses the pool outside run', () => {
    expect(uow.manager).toBe(db.manager);
  });
});
