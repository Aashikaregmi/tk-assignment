import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { INestApplication } from '@nestjs/common';
import { seedUsers } from '@modules/identity/seed-users';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { createTestApp } from './test-app';

// Fake data only.
const input = {
  businessName: 'Example Coffee',
  legalBusinessName: 'Example Coffee LLC',
  businessType: 'LLC',
  ownerContact: { fullName: 'Jane Example', email: 'jane@example.com', phone: '+15550100123' },
  processingInfo: { monthlyVolumeCents: 2_500_000, averageTicketCents: 4_500, mcc: '5812' },
};

type User = 'salesA' | 'salesB';
const EMAILS: Record<User, string> = {
  salesA: 'sales.one@example.com',
  salesB: 'sales.two@example.com',
};

describe('Idempotency-Key (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  const tokens = {} as Record<User, string>;
  const ids = {} as Record<User, string>;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    db = app.get(DataSource);
    const password = randomUUID();
    await db.transaction((manager) => seedUsers(manager, password));
    for (const [user, email] of Object.entries(EMAILS) as [User, string][]) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      tokens[user] = (response.body as { accessToken: string }).accessToken;
      const [row] = await db.query<{ id: string }[]>('SELECT id FROM users WHERE email = $1', [
        email,
      ]);
      ids[user] = row!.id;
    }
  });

  afterAll(() => app.close());

  const post = (user: User, path: string, body: object | undefined, key?: string) => {
    const call = request(app.getHttpServer())
      .post(path)
      .auth(tokens[user], { type: 'bearer' })
      .send(body);
    return key === undefined ? call : call.set('Idempotency-Key', key);
  };
  // Each test names its applications uniquely, so counts are per test.
  const named = (businessName: string) => ({ ...input, businessName });
  const countNamed = async (businessName: string) =>
    Number(
      (
        await db.query<{ count: string }[]>(
          'SELECT count(*) FROM merchant_applications WHERE business_name = $1',
          [businessName],
        )
      )[0]!.count,
    );
  const create = async (businessName: string) =>
    (
      (await post('salesA', '/applications', named(businessName)).expect(201)).body as {
        id: string;
      }
    ).id;

  describe('replay', () => {
    it('the same key twice: the same response, one application, one audit entry', async () => {
      const key = randomUUID();

      const first = await post('salesA', '/applications', named('Replay Shop'), key).expect(201);
      const second = await post('salesA', '/applications', named('Replay Shop'), key).expect(201);

      expect(second.body).toEqual(first.body);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(await countNamed('Replay Shop')).toBe(1);
      const [audit] = await db.query<{ count: string }[]>(
        "SELECT count(*) FROM audit_log WHERE action = 'ApplicationCreated' AND entity_id = $1",
        [(first.body as { id: string }).id],
      );
      expect(audit?.count).toBe('1');
    });

    it('a retried submit replays its 200 instead of failing as already submitted', async () => {
      const id = await create('Submit Shop');
      const key = randomUUID();

      const first = await post('salesA', `/applications/${id}/submit`, undefined, key).expect(200);
      const retry = await post('salesA', `/applications/${id}/submit`, undefined, key).expect(200);

      expect(retry.body).toEqual(first.body);
      await post('salesA', `/applications/${id}/submit`, undefined).expect(409);
      const [outbox] = await db.query<{ count: string }[]>(
        "SELECT count(*) FROM outbox WHERE payload->>'applicationId' = $1",
        [id],
      );
      expect(outbox?.count).toBe('1');
    });

    it('a request that failed is not remembered: a corrected retry with the key succeeds', async () => {
      const key = randomUUID();

      await post('salesA', '/applications', named(''), key).expect(422);
      await post('salesA', '/applications', named('Fixed Shop'), key).expect(201);

      expect(await countNamed('Fixed Shop')).toBe(1);
    });

    it('keys belong to one user: another user with the same key gets their own result', async () => {
      const key = randomUUID();
      const a = await post('salesA', '/applications', named('Scoped Shop'), key).expect(201);

      const b = await post('salesB', '/applications', named('Scoped Shop'), key).expect(201);

      expect(b.headers['idempotent-replayed']).toBeUndefined();
      expect(b.body).toMatchObject({ createdBy: ids.salesB });
      expect((b.body as { id: string }).id).not.toBe((a.body as { id: string }).id);
    });

    it('without a key, every request is a new one', async () => {
      await post('salesA', '/applications', named('Keyless Shop')).expect(201);
      await post('salesA', '/applications', named('Keyless Shop')).expect(201);

      expect(await countNamed('Keyless Shop')).toBe(2);
    });

    it('runs the request, its command and the stored response in one transaction', async () => {
      const transaction = jest.spyOn(db, 'transaction');
      try {
        await post('salesA', '/applications', named('One Tx Shop'), randomUUID()).expect(201);

        expect(transaction).toHaveBeenCalledTimes(1);
      } finally {
        transaction.mockRestore();
      }
    });
  });

  describe('mismatch', () => {
    it('the same key with a different body is 422 and does nothing', async () => {
      const key = randomUUID();
      await post('salesA', '/applications', named('Original Shop'), key).expect(201);

      const response = await post('salesA', '/applications', named('Changed Shop'), key).expect(
        422,
      );

      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(response.body).toMatchObject({
        detail: 'Idempotency-Key was already used for a different request',
      });
      expect(await countNamed('Changed Shop')).toBe(0);
    });

    it('the same key on another application’s submit is 422', async () => {
      const [first, second] = [await create('Path Shop'), await create('Path Shop')];
      const key = randomUUID();
      await post('salesA', `/applications/${first}/submit`, undefined, key).expect(200);

      await post('salesA', `/applications/${second}/submit`, undefined, key).expect(422);
    });

    it('property order alone is not a different body', async () => {
      const key = randomUUID();
      await post('salesA', '/applications', named('Ordered Shop'), key).expect(201);
      const reversed = Object.fromEntries(Object.entries(named('Ordered Shop')).reverse());

      const retry = await post('salesA', '/applications', reversed, key).expect(201);

      expect(retry.headers['idempotent-replayed']).toBe('true');
    });

    it.each([
      ['a space', 'has space'],
      ['a non-ASCII character', 'clé'],
      ['more than 255 characters', 'k'.repeat(256)],
      ['an empty value', ''],
    ])('rejects a key with %s: 400', async (_case, key) => {
      await post('salesA', '/applications', named('Bad Key Shop'), key).expect(400);
    });

    it('accepts a 255-character key', async () => {
      await post('salesA', '/applications', named('Long Key Shop'), 'k'.repeat(255)).expect(201);
    });
  });

  describe('concurrency', () => {
    // The test holds the key first, so all five requests wait on it at once. When it lets go, one
    // claims the key and runs; the rest wait on that one, then replay its response.
    it('five parallel requests with one key: one application, five identical answers', async () => {
      const key = randomUUID();
      const holder = db.createQueryRunner();
      await holder.startTransaction();

      let responses: request.Response[];
      try {
        await holder.query(
          'INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)',
          [ids.salesA, key, createHash('sha256').update('placeholder').digest('hex')],
        );
        const pending = Promise.all(
          Array.from({ length: 5 }, () =>
            post('salesA', '/applications', named('Parallel Shop'), key),
          ),
        );
        await sleep(300);
        await holder.rollbackTransaction();
        responses = await pending;
      } finally {
        if (holder.isTransactionActive) await holder.rollbackTransaction();
        await holder.release();
      }

      expect(responses.map(({ status }) => status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(responses.map(({ body }) => (body as { id: string }).id)).size).toBe(1);
      expect(responses.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(4);
      expect(await countNamed('Parallel Shop')).toBe(1);
    });
  });
});
