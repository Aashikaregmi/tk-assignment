import { randomUUID } from 'node:crypto';
import { UsersService } from '@modules/identity';
import { UserOrmEntity } from '@modules/identity/user.orm-entity';
import { Role } from '@shared/domain/role';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

// Well-formed but not a hash of anything.
const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2g';

describe('UsersService', () => {
  let db: DataSource;
  let users: UsersService;

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
    users = new UsersService(new TypeOrmUnitOfWork(db));
  });

  afterAll(() => db.destroy());

  beforeEach(() => resetDatabase());

  const save = (user: Partial<UserOrmEntity> = {}) =>
    db.getRepository(UserOrmEntity).save({
      email: 'sales.one@example.com',
      passwordHash: FAKE_HASH,
      role: 'SALES',
      ...user,
    });

  it('finds a user by email, ignoring case', async () => {
    await save({ email: 'Sales.One@Example.com' });

    await expect(users.findByEmail('sales.one@EXAMPLE.com')).resolves.toMatchObject({
      email: 'Sales.One@Example.com',
      role: 'SALES',
    });
    await expect(users.findByEmail('nobody@example.com')).resolves.toBeNull();
  });

  it('finds a user by id', async () => {
    const { id } = await save();

    await expect(users.findById(id)).resolves.toMatchObject({ id, role: 'SALES' });
    await expect(users.findById(randomUUID())).resolves.toBeNull();
  });

  it('rejects an email that differs from an existing one only by case', async () => {
    await save();
    await expect(save({ email: 'SALES.ONE@example.com' })).rejects.toThrow(/users_email_key/);
  });

  it.each([
    ['an unknown role', { role: 'OWNER' as Role }, /users_role_check/],
    ['a plaintext password', { passwordHash: 'hunter2' }, /users_password_hash_check/],
  ])('rejects %s', async (_case, user, constraint) => {
    await expect(save(user)).rejects.toThrow(constraint);
  });
});
