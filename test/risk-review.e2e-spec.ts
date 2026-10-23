import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { INestApplication } from '@nestjs/common';
import { RiskReviewWorker } from '@modules/applications';
import { RISK_REVIEW_QUEUE } from '@modules/applications/infrastructure/risk-review-queue';
import { seedUsers } from '@modules/identity/seed-users';
import { OutboxRelay } from '@modules/outbox';
import { AppConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { Queues } from '@shared/infrastructure/queue/queues';
import { Queue } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { createTestApp } from './test-app';
import { testEnv } from './test-env';

// Fake data only. Scores 10: LOW.
const input = {
  businessName: 'Example Coffee',
  legalBusinessName: 'Example Coffee LLC',
  businessType: 'LLC',
  ownerContact: { fullName: 'Jane Example', email: 'jane@example.com', phone: '+15550100123' },
  processingInfo: { monthlyVolumeCents: 2_500_000, averageTicketCents: 4_500, mcc: '5812' },
};

interface Application {
  id: string;
  riskStatus: string;
}
interface AuditPage {
  items: { actorId: string | null; action: string; metadata: object }[];
}

// Polls until done(value) or the deadline, then returns the last value for the assertion.
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 25_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(100);
  }
}

describe('risk review (e2e)', () => {
  const password = randomUUID();
  const config = loadConfig(AppConfig, { ...testEnv(), JWT_SECRET: 'x'.repeat(32) });
  const clearQueue = async () => {
    const queue = new Queue(RISK_REVIEW_QUEUE, {
      connection: { host: config.REDIS_HOST, port: config.REDIS_PORT, db: config.REDIS_DB },
    });
    await queue.obliterate({ force: true });
    await queue.close();
  };

  beforeAll(async () => {
    await resetDatabase();
    await clearQueue();
    const db = await new DataSource(dataSourceOptions(config)).initialize();
    await db.transaction((manager) => seedUsers(manager, password));
    await db.destroy();
  });

  afterAll(clearQueue);

  // The full app with its background work running, as main.ts starts it.
  function pipeline(providerFailures: number) {
    const ctx = {} as {
      app: INestApplication<App>;
      db: DataSource;
      queue: Queue;
      tokens: Record<'sales' | 'admin' | 'reviewer', string>;
    };

    beforeAll(async () => {
      ctx.app = await createTestApp({ env: { RISK_PROVIDER_FAILURES: String(providerFailures) } });
      ctx.app.get(OutboxRelay).start();
      ctx.app.get(RiskReviewWorker).start();
      ctx.db = ctx.app.get(DataSource);
      ctx.queue = ctx.app.get(Queues).get(RISK_REVIEW_QUEUE);
      const login = async (email: string) =>
        (
          (
            await request(ctx.app.getHttpServer())
              .post('/auth/login')
              .send({ email, password })
              .expect(200)
          ).body as { accessToken: string }
        ).accessToken;
      ctx.tokens = {
        sales: await login('sales.one@example.com'),
        admin: await login('admin@example.com'),
        reviewer: await login('reviewer.one@example.com'),
      };
    });

    afterAll(() => ctx.app.close());
    return ctx;
  }

  function client(ctx: ReturnType<typeof pipeline>) {
    const as = (user: keyof typeof ctx.tokens) => ({
      get: (path: string) =>
        request(ctx.app.getHttpServer()).get(path).auth(ctx.tokens[user], { type: 'bearer' }),
      post: (path: string, body?: object) =>
        request(ctx.app.getHttpServer())
          .post(path)
          .auth(ctx.tokens[user], { type: 'bearer' })
          .send(body),
    });
    return {
      as,
      async submitNew(): Promise<string> {
        const { id } = (await as('sales').post('/applications', input).expect(201))
          .body as Application;
        await as('sales').post(`/applications/${id}/submit`).expect(200);
        return id;
      },
      reviewed: (id: string) =>
        eventually(
          async () =>
            (await as('sales').get(`/applications/${id}`).expect(200)).body as Application,
          ({ riskStatus }) => riskStatus !== 'PENDING',
        ),
      reviewsOf: (id: string) =>
        ctx.db.query<{ submission_no: number; result: string; score: number | null }[]>(
          'SELECT submission_no, result, score FROM risk_reviews WHERE application_id = $1 ORDER BY submission_no',
          [id],
        ),
      riskAudit: async (id: string) =>
        ((await as('admin').get(`/audit?entityId=${id}`).expect(200)).body as AuditPage).items
          .filter(({ action }) => action.startsWith('RiskReview'))
          .map(({ actorId, action, metadata }) => ({ actorId, action, metadata })),
      // The job the outbox relay created for this submission: its id is the outbox row's id.
      async jobFor(id: string, submissionNo: number) {
        const [row] = await ctx.db.query<{ id: string }[]>(
          "SELECT id FROM outbox WHERE payload->>'applicationId' = $1 AND (payload->>'submissionNo')::int = $2",
          [id, submissionNo],
        );
        return ctx.queue.getJob(row!.id);
      },
    };
  }

  describe('the provider answers', () => {
    const ctx = pipeline(0);
    const api = client(ctx);

    it('submit → result recorded, status updated, audited as the system', async () => {
      const id = await api.submitNew();

      expect(await api.reviewed(id)).toMatchObject({ riskStatus: 'LOW' });
      expect(await api.reviewsOf(id)).toEqual([{ submission_no: 1, result: 'LOW', score: 10 }]);
      expect(await api.riskAudit(id)).toEqual([
        {
          actorId: null,
          action: 'RiskReviewCompleted',
          metadata: { submissionNo: 1, result: 'LOW' },
        },
      ]);
    });

    it('a duplicate delivery of the job adds nothing', async () => {
      const id = await api.submitNew();
      await api.reviewed(id);

      // A second job for the same submission, as if the outbox row were re-sent after the
      // first job had been cleaned up (so BullMQ's jobId check can't catch it).
      const duplicate = await ctx.queue.add(
        'ApplicationSubmitted',
        { applicationId: id, submissionNo: 1 },
        { jobId: randomUUID() },
      );
      expect(
        await eventually(
          () => duplicate.getState(),
          (s) => s === 'completed',
        ),
      ).toBe('completed');

      expect(await api.reviewsOf(id)).toHaveLength(1);
      expect(await api.riskAudit(id)).toHaveLength(1);
    });

    it('a resubmission gets its own review', async () => {
      const id = await api.submitNew();
      await api.reviewed(id);
      const [reviewer] = await ctx.db.query<{ id: string }[]>(
        "SELECT id FROM users WHERE email = 'reviewer.one@example.com'",
      );
      await api
        .as('admin')
        .post(`/applications/${id}/assignment`, { reviewerId: reviewer!.id })
        .expect(200);
      await api
        .as('reviewer')
        .post(`/applications/${id}/decision`, {
          decision: 'REQUEST_INFO',
          reason: 'Please confirm the volume',
        })
        .expect(200);

      await api.as('sales').post(`/applications/${id}/submit`).expect(200);

      expect(await api.reviewed(id)).toMatchObject({ riskStatus: 'LOW' });
      expect((await api.reviewsOf(id)).map((r) => r.submission_no)).toEqual([1, 2]);
    });
  });

  describe('the provider fails twice, then answers', () => {
    const ctx = pipeline(2);
    const api = client(ctx);

    it('retries and records exactly one result', async () => {
      const id = await api.submitNew();

      expect(await api.reviewed(id)).toMatchObject({ riskStatus: 'LOW' });
      expect(await api.reviewsOf(id)).toEqual([{ submission_no: 1, result: 'LOW', score: 10 }]);
      expect(await api.riskAudit(id)).toHaveLength(1);
      const job = await api.jobFor(id, 1);
      expect(job?.attemptsStarted).toBe(3);
    });
  });

  describe('the provider never answers', () => {
    const ctx = pipeline(5);
    const api = client(ctx);

    it('after five attempts marks the review FAILED, audited as the system', async () => {
      const id = await api.submitNew();

      expect(await api.reviewed(id)).toMatchObject({ riskStatus: 'FAILED' });
      expect(await api.reviewsOf(id)).toEqual([
        { submission_no: 1, result: 'FAILED', score: null },
      ]);
      expect(await api.riskAudit(id)).toEqual([
        { actorId: null, action: 'RiskReviewFailed', metadata: { submissionNo: 1 } },
      ]);
      const job = await api.jobFor(id, 1);
      expect(job?.attemptsStarted).toBe(5);
      expect(await job?.getState()).toBe('completed');
    });
  });
});
