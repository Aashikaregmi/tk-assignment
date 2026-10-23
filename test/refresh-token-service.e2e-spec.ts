import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { AuditWriter } from '@modules/audit';
import { RefreshTokenService } from '@modules/identity/refresh-token.service';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2g';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface Row {
  id: string;
  family_id: string;
  token_hash: string;
  revoked_at: Date | null;
  replaced_by: string | null;
}

describe('RefreshTokenService', () => {
  let db: DataSource;
  let service: RefreshTokenService;
  let userId: string;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
    const uow = new TypeOrmUnitOfWork(db);
    service = new RefreshTokenService(uow, new AuditWriter(uow));
  });

  afterAll(() => db.destroy());

  beforeEach(async () => {
    await resetDatabase();
    const [user] = await db.query<{ id: string }[]>(
      "INSERT INTO users (email, password_hash, role) VALUES ('sales.one@example.com', $1, 'SALES') RETURNING id",
      [FAKE_HASH],
    );
    userId = user!.id;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  const rows = () =>
    db.query<Row[]>(
      'SELECT id, family_id, token_hash, revoked_at, replaced_by FROM refresh_tokens ORDER BY created_at, id',
    );
  const rowOf = async (token: string) =>
    (await rows()).find((r) => r.token_hash === sha256(token))!;
  const audit = () =>
    db.query<{ action: string; entity_id: string; metadata: unknown }[]>(
      'SELECT action, entity_id, metadata FROM audit_log',
    );
  const refused = (token: string) =>
    expect(service.rotate(token)).rejects.toThrow(
      new UnauthorizedException('Invalid refresh token'),
    );

  it('issues a 256-bit opaque token and stores only its SHA-256', async () => {
    const token = await service.issue(userId);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('rotates: the old token is revoked and points to its successor in the same family', async () => {
    const first = await service.issue(userId);

    const { userId: owner, refreshToken: second } = await service.rotate(first);

    expect(owner).toBe(userId);
    expect(second).not.toBe(first);
    const [old, next] = [await rowOf(first), await rowOf(second)];
    expect(old).toMatchObject({ replaced_by: next.id, family_id: next.family_id });
    expect(old.revoked_at).toBeInstanceOf(Date);
    expect(next.revoked_at).toBeNull();
    await expect(service.rotate(second)).resolves.toMatchObject({ userId });
  });

  it('reuse of a rotated token revokes the whole family, audits it and warns', async () => {
    const first = await service.issue(userId);
    const { refreshToken: second } = await service.rotate(first);
    const otherLogin = await service.issue(userId);

    await refused(first);

    const { family_id: familyId } = await rowOf(first);
    expect((await rows()).filter((r) => r.family_id === familyId).every((r) => r.revoked_at)).toBe(
      true,
    );
    const detected = {
      action: 'RefreshTokenReuseDetected',
      entity_id: userId,
      metadata: { familyId },
    };
    expect(await audit()).toEqual([detected]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`family ${familyId} revoked`));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(first);
    // The successor is dead too; presenting it is another revoked token, so another entry.
    await refused(second);
    expect(await audit()).toEqual([detected, detected]);
    // The user's other login is a different family and keeps working.
    await expect(service.rotate(otherLogin)).resolves.toMatchObject({ userId });
  });

  it('an expired token is refused, but is not treated as reuse', async () => {
    const token = await service.issue(userId);
    await db.query(
      "UPDATE refresh_tokens SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day'",
    );

    await refused(token);

    expect((await rowOf(token)).revoked_at).toBeNull();
    expect(await audit()).toEqual([]);
  });

  it('an unknown token is refused and writes nothing', async () => {
    await service.issue(userId);

    await refused('not-a-token-we-issued');

    expect(await rows()).toHaveLength(1);
    expect(await audit()).toEqual([]);
  });

  it('logout revokes the family; unknown tokens are ignored', async () => {
    const token = await service.issue(userId);

    await service.revoke(token);
    await service.revoke('not-a-token-we-issued');

    expect((await rowOf(token)).revoked_at).toBeInstanceOf(Date);
    await refused(token);
  });

  // Strict by design: the row lock makes the second request see a revoked token, which is reuse.
  // The test holds the lock first so both requests overlap; without the service's own lock,
  // both would read the token as valid and both would succeed.
  it('two refreshes racing with one token: one wins, the other ends the session', async () => {
    const token = await service.issue(userId);
    const holder = db.createQueryRunner();
    await holder.startTransaction();

    let results: PromiseSettledResult<{ refreshToken: string }>[];
    try {
      await holder.query('SELECT id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [
        sha256(token),
      ]);
      const racing = Promise.allSettled([service.rotate(token), service.rotate(token)]);
      await sleep(300);
      await holder.commitTransaction();
      results = await racing;
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
    }

    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    await refused((won[0] as PromiseFulfilledResult<{ refreshToken: string }>).value.refreshToken);
  });
});
