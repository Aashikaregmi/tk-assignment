import { loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { DataSource } from 'typeorm';
import { testEnv } from './test-env';

describe('app database role', () => {
  let db: DataSource;

  beforeAll(async () => {
    db = await new DataSource(dataSourceOptions(loadConfig(testEnv()))).initialize();
  });

  afterAll(() => db.destroy());

  // Rolled back either way, so a misconfigured run can't damage the schema.
  async function attempt(sql: string): Promise<void> {
    const runner = db.createQueryRunner();
    await runner.startTransaction();
    try {
      await runner.query(sql);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }

  it('reads tables the owner created', async () => {
    await expect(attempt('SELECT * FROM migrations')).resolves.toBeUndefined();
  });

  it.each([
    ['create tables', 'CREATE TABLE probe (id int)'],
    ['drop tables', 'DROP TABLE migrations'],
    ['alter tables', 'ALTER TABLE migrations ADD COLUMN probe int'],
    ['disable triggers', 'ALTER TABLE migrations DISABLE TRIGGER ALL'],
    ['skip triggers for the session', 'SET session_replication_role = replica'],
    ['truncate tables', 'TRUNCATE migrations'],
    ['create roles', 'CREATE ROLE probe'],
  ])('cannot %s', async (_action, sql) => {
    await expect(attempt(sql)).rejects.toThrow(/permission denied|must be owner/);
  });
});
