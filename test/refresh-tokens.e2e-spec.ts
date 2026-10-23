import { createHash, randomUUID } from 'node:crypto';
import { RefreshTokenOrmEntity } from '@modules/identity/refresh-token.orm-entity';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2g';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('refresh_tokens', () => {
  let db: DataSource;
  let userId: string;

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
  });

  afterAll(() => db.destroy());

  beforeEach(async () => {
    await resetDatabase();
    const [user] = await db.query<{ id: string }[]>(
      "INSERT INTO users (email, password_hash, role) VALUES ('sales.one@example.com', $1, 'SALES') RETURNING id",
      [FAKE_HASH],
    );
    userId = user!.id;
  });

  const tokens = () => db.getRepository(RefreshTokenOrmEntity);
  const token = (overrides: Partial<RefreshTokenOrmEntity> = {}) =>
    tokens().insert({
      id: randomUUID(),
      userId,
      familyId: randomUUID(),
      tokenHash: sha256(randomUUID()),
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    });

  it('the app role stores, finds by hash and revokes tokens', async () => {
    const tokenHash = sha256('first');
    await token({ tokenHash });
    const next = randomUUID();
    await token({ id: next });

    const stored = await tokens().findOneByOrFail({ tokenHash });
    await tokens().update(stored.id, { revokedAt: new Date(), replacedBy: next });

    expect(await tokens().findOneByOrFail({ tokenHash })).toMatchObject({
      userId,
      replacedBy: next,
      revokedAt: expect.any(Date) as Date,
    });
  });

  it.each<[string, Partial<RefreshTokenOrmEntity>, RegExp]>([
    ['a raw token instead of its hash', { tokenHash: 'not-a-hash' }, /token_hash_check/],
    ['an uppercase or short digest', { tokenHash: 'ABC123' }, /token_hash_check/],
    [
      'a successor on a token that is not revoked',
      { replacedBy: randomUUID() },
      /replaced_by_check/,
    ],
    ['an expiry in the past', { expiresAt: new Date(Date.now() - 1000) }, /expires_at_check/],
    ['an unknown user', { userId: randomUUID() }, /user_id_fkey/],
  ])('rejects %s', async (_case, overrides, constraint) => {
    await expect(token(overrides)).rejects.toThrow(constraint);
  });

  it('rejects a second token with the same hash', async () => {
    await token({ tokenHash: sha256('same') });
    await expect(token({ tokenHash: sha256('same') })).rejects.toThrow(
      /refresh_tokens_token_hash_key/,
    );
  });
});
