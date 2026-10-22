import { randomUUID } from 'node:crypto';
import { PasswordHasher } from '@modules/identity/password-hasher';
import { SEED_USERS, seedUsers } from '@modules/identity/seed-users';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

describe('seedUsers', () => {
  let db: DataSource;

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
  });

  afterAll(() => db.destroy());

  beforeEach(() => resetDatabase());

  it('seeds only fake example.com users', () => {
    expect(SEED_USERS.map(({ role }) => role).sort()).toEqual([
      'ADMIN',
      'REVIEWER',
      'REVIEWER',
      'SALES',
      'SALES',
    ]);
    for (const { email } of SEED_USERS) expect(email).toMatch(/@example\.com$/);
  });

  it('is idempotent and a re-run resets the password', async () => {
    const first = randomUUID();
    const second = randomUUID();

    await db.transaction((manager) => seedUsers(manager, first));
    await db.transaction((manager) => seedUsers(manager, second));

    const rows = await db.query<{ email: string; role: string; password_hash: string }[]>(
      'SELECT email, role, password_hash FROM users ORDER BY email',
    );
    expect(rows.map(({ email, role }) => ({ email, role }))).toEqual(
      [...SEED_USERS].sort((a, b) => a.email.localeCompare(b.email)),
    );

    const hasher = new PasswordHasher();
    const hash = rows[0]!.password_hash;
    await expect(hasher.verify(hash, second)).resolves.toBe(true);
    await expect(hasher.verify(hash, first)).resolves.toBe(false);
  });
});
