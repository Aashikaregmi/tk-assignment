import { randomUUID } from 'node:crypto';
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

type User = 'salesA' | 'salesB' | 'reviewer' | 'otherReviewer' | 'admin';
const EMAILS: Record<User, string> = {
  salesA: 'sales.one@example.com',
  salesB: 'sales.two@example.com',
  reviewer: 'reviewer.one@example.com',
  otherReviewer: 'reviewer.two@example.com',
  admin: 'admin@example.com',
};

interface Body {
  id: string;
  status: string;
  [key: string]: unknown;
}

describe('applications (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  const tokens = {} as Record<User, string>;
  const ids = {} as Record<User, string>;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    db = app.get(DataSource);
    const password: string = randomUUID();
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

  const as = (user: User) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(path).auth(tokens[user], { type: 'bearer' }),
    post: (path: string, body?: object) =>
      request(app.getHttpServer()).post(path).auth(tokens[user], { type: 'bearer' }).send(body),
    patch: (path: string, body: object) =>
      request(app.getHttpServer()).patch(path).auth(tokens[user], { type: 'bearer' }).send(body),
  });

  async function createAs(user: User, overrides: object = {}): Promise<Body> {
    const response = await as(user)
      .post('/applications', { ...input, ...overrides })
      .expect(201);
    return response.body as Body;
  }

  async function submittedBy(user: User): Promise<string> {
    const { id } = await createAs(user);
    await as(user).post(`/applications/${id}/submit`).expect(200);
    return id;
  }

  // Stands in for the risk worker (E10).
  const riskResultIn = (id: string) =>
    db.query("UPDATE merchant_applications SET risk_status = 'LOW' WHERE id = $1", [id]);

  // Submitted by SALES-A, assigned to `reviewer`, risk result in.
  async function awaitingDecision(): Promise<string> {
    const id = await submittedBy('salesA');
    await as('admin')
      .post(`/applications/${id}/assignment`, { reviewerId: ids.reviewer })
      .expect(200);
    await riskResultIn(id);
    return id;
  }

  const read = async (id: string) =>
    (await as('admin').get(`/applications/${id}`).expect(200)).body as Body;

  describe('SALES isolation', () => {
    let foreign: Body;

    beforeAll(async () => {
      foreign = await createAs('salesA', { businessName: 'SALES-A Shop' });
    });

    // Same answer as for an id that doesn't exist, so SALES-B can't even learn it exists.
    it('SALES-B cannot read SALES-A’s application by id: 404', async () => {
      const response = await as('salesB').get(`/applications/${foreign.id}`).expect(404);
      expect(response.body).toMatchObject({ code: 'APPLICATION_NOT_FOUND' });

      const missing = await as('salesB').get(`/applications/${randomUUID()}`).expect(404);
      expect(missing.body).toEqual(response.body);
    });

    it('SALES-B cannot update SALES-A’s application: 404, nothing changed', async () => {
      await as('salesB')
        .patch(`/applications/${foreign.id}`, { businessName: 'Hijacked' })
        .expect(404);

      const unchanged = await as('salesA').get(`/applications/${foreign.id}`).expect(200);
      expect(unchanged.body).toMatchObject({ businessName: 'SALES-A Shop', status: 'DRAFT' });
    });

    it('SALES-B cannot submit SALES-A’s application: 404, still a draft', async () => {
      await as('salesB').post(`/applications/${foreign.id}/submit`).expect(404);

      const unchanged = await as('salesA').get(`/applications/${foreign.id}`).expect(200);
      expect(unchanged.body).toMatchObject({ status: 'DRAFT', riskStatus: 'NOT_STARTED' });
    });

    it('lists contain only the caller’s own applications', async () => {
      const own = await createAs('salesB', { businessName: 'SALES-B Shop' });

      const listB = await as('salesB').get('/applications?limit=100').expect(200);
      const idsB = (listB.body as { items: Body[] }).items.map(({ id }) => id);
      expect(idsB).toContain(own.id);
      expect(idsB).not.toContain(foreign.id);

      const listA = await as('salesA').get('/applications?limit=100').expect(200);
      expect((listA.body as { items: Body[] }).items.map(({ id }) => id)).not.toContain(own.id);
    });

    it('a status filter cannot widen the scope', async () => {
      const own = await createAs('salesB');

      const response = await as('salesB').get('/applications?status=DRAFT&limit=100').expect(200);

      const { items } = response.body as { items: Body[] };
      expect(items.length).toBeGreaterThan(0);
      expect(items.every(({ createdBy }) => createdBy === own.createdBy)).toBe(true);
    });

    it('createdBy cannot be forged on create', async () => {
      await as('salesB')
        .post('/applications', { ...input, createdBy: foreign.createdBy as string })
        .expect(400);
    });
  });

  describe('lifecycle', () => {
    it('create → update → submit', async () => {
      const created = await createAs('salesA');
      expect(created).toMatchObject({
        status: 'DRAFT',
        riskStatus: 'NOT_STARTED',
        assignedReviewerId: null,
        processingInfo: input.processingInfo,
      });

      const updated = await as('salesA')
        .patch(`/applications/${created.id}`, { businessName: 'Example Roasters' })
        .expect(200);
      expect(updated.body).toMatchObject({
        businessName: 'Example Roasters',
        legalBusinessName: 'Example Coffee LLC',
      });

      const submitted = await as('salesA').post(`/applications/${created.id}/submit`).expect(200);
      expect(submitted.body).toMatchObject({ status: 'SUBMITTED', riskStatus: 'PENDING' });
    });

    it('refuses edits and a second submit after submission: 409', async () => {
      const { id } = await createAs('salesA');
      await as('salesA').post(`/applications/${id}/submit`).expect(200);

      const edit = await as('salesA').patch(`/applications/${id}`, { businessName: 'Late' });
      expect(edit.status).toBe(409);
      expect(edit.body).toMatchObject({ code: 'APPLICATION_NOT_EDITABLE' });

      const again = await as('salesA').post(`/applications/${id}/submit`).expect(409);
      expect(again.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });

    it.each([
      ['status', { status: 'APPROVED' }],
      ['assignedReviewerId', { assignedReviewerId: randomUUID() }],
      ['an unknown field', { discountPercent: 50 }],
    ])('rejects %s in the body: 400', async (field, extra) => {
      const { id } = await createAs('salesA');
      const response = await as('salesA').patch(`/applications/${id}`, extra).expect(400);
      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      expect((response.body as { errors: string[] }).errors[0]).toMatch(/should not exist/);
    });

    it('rejects a business-rule violation: 422', async () => {
      const response = await as('salesA')
        .post('/applications', {
          ...input,
          processingInfo: { ...input.processingInfo, averageTicketCents: 3_000_000 },
        })
        .expect(422);
      expect(response.body).toMatchObject({ code: 'INVALID_APPLICATION_DATA' });
    });

    it('rejects a malformed id: 400', async () => {
      await as('salesA').get('/applications/not-a-uuid').expect(400);
    });
  });

  describe('other roles', () => {
    it('REVIEWER cannot create or edit: 403', async () => {
      await as('reviewer').post('/applications', input).expect(403);

      const { id } = await createAs('salesA');
      await as('salesA').post(`/applications/${id}/submit`).expect(200);
      await as('reviewer').patch(`/applications/${id}`, { businessName: 'X' }).expect(403);
    });

    it('REVIEWER sees submitted applications but not drafts', async () => {
      const draft = await createAs('salesA');
      const submitted = await createAs('salesA');
      await as('salesA').post(`/applications/${submitted.id}/submit`).expect(200);

      await as('reviewer').get(`/applications/${draft.id}`).expect(404);
      await as('reviewer').get(`/applications/${submitted.id}`).expect(200);
    });

    it('ADMIN can read and edit any application', async () => {
      const { id } = await createAs('salesA');

      await as('admin').get(`/applications/${id}`).expect(200);
      const edited = await as('admin').patch(`/applications/${id}`, { businessName: 'Fixed' });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ businessName: 'Fixed' });
    });
  });

  describe('reviewer assignment', () => {
    it('ADMIN assigns, and reassigns until decided', async () => {
      const id = await submittedBy('salesA');

      const first = await as('admin')
        .post(`/applications/${id}/assignment`, { reviewerId: ids.otherReviewer })
        .expect(200);
      expect(first.body).toMatchObject({ assignedReviewerId: ids.otherReviewer });

      const second = await as('admin')
        .post(`/applications/${id}/assignment`, { reviewerId: ids.reviewer })
        .expect(200);
      expect(second.body).toMatchObject({ assignedReviewerId: ids.reviewer });
    });

    it.each<User>(['salesA', 'reviewer'])('%s cannot assign: 403', async (user) => {
      const id = await submittedBy('salesA');

      await as(user)
        .post(`/applications/${id}/assignment`, { reviewerId: ids.reviewer })
        .expect(403);

      expect(await read(id)).toMatchObject({ assignedReviewerId: null });
    });

    it.each<[string, () => string]>([
      ['a SALES user', () => ids.salesA],
      ['an ADMIN', () => ids.admin],
      ['an unknown user', () => randomUUID()],
    ])('refuses %s as the reviewer: 422', async (_case, target) => {
      const id = await submittedBy('salesA');

      const response = await as('admin')
        .post(`/applications/${id}/assignment`, { reviewerId: target() })
        .expect(422);

      expect(response.body).toMatchObject({ code: 'INVALID_REVIEWER' });
      expect(await read(id)).toMatchObject({ assignedReviewerId: null });
    });

    it('refuses a draft: 409', async () => {
      const { id } = await createAs('salesA');
      await as('admin')
        .post(`/applications/${id}/assignment`, { reviewerId: ids.reviewer })
        .expect(409);
    });
  });

  describe('decisions', () => {
    it.each<[User, string | undefined]>([
      ['otherReviewer', 'NOT_ASSIGNED_REVIEWER'],
      ['admin', undefined],
      ['salesA', undefined],
    ])('%s cannot decide: 403, nothing changed', async (user, code) => {
      const id = await awaitingDecision();

      const response = await as(user)
        .post(`/applications/${id}/decision`, { decision: 'APPROVE' })
        .expect(403);

      if (code) expect(response.body).toMatchObject({ code });
      expect(await read(id)).toMatchObject({ status: 'SUBMITTED', decisionReason: null });
    });

    it('waits for the risk review: 409', async () => {
      const id = await submittedBy('salesA');
      await as('admin')
        .post(`/applications/${id}/assignment`, { reviewerId: ids.reviewer })
        .expect(200);

      const response = await as('reviewer')
        .post(`/applications/${id}/decision`, { decision: 'APPROVE' })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'RISK_RESULT_REQUIRED' });
    });

    it('requires a reason to reject: 422', async () => {
      const id = await awaitingDecision();
      await as('reviewer').post(`/applications/${id}/decision`, { decision: 'REJECT' }).expect(422);
    });

    it('is final: deciding again, editing and reassigning are refused with 409', async () => {
      const id = await awaitingDecision();
      await as('reviewer')
        .post(`/applications/${id}/decision`, { decision: 'REJECT', reason: 'MCC not supported' })
        .expect(200);

      const again = await as('reviewer')
        .post(`/applications/${id}/decision`, { decision: 'APPROVE' })
        .expect(409);
      expect(again.body).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      await as('salesA').patch(`/applications/${id}`, { businessName: 'Late' }).expect(409);
      await as('admin')
        .post(`/applications/${id}/assignment`, { reviewerId: ids.otherReviewer })
        .expect(409);
      expect(await read(id)).toMatchObject({
        status: 'REJECTED',
        decisionReason: 'MCC not supported',
        assignedReviewerId: ids.reviewer,
      });
    });

    it('request info → SALES edits and resubmits → approve', async () => {
      const id = await awaitingDecision();

      await as('reviewer')
        .post(`/applications/${id}/decision`, {
          decision: 'REQUEST_INFO',
          reason: 'Please confirm the monthly volume',
        })
        .expect(200);
      const requested = await as('salesA').get(`/applications/${id}`).expect(200);
      expect(requested.body).toMatchObject({
        status: 'INFO_REQUESTED',
        decisionReason: 'Please confirm the monthly volume',
      });

      await as('salesA')
        .patch(`/applications/${id}`, { businessName: 'Example Roasters' })
        .expect(200);
      const resubmitted = await as('salesA').post(`/applications/${id}/submit`).expect(200);
      expect(resubmitted.body).toMatchObject({
        status: 'SUBMITTED',
        riskStatus: 'PENDING',
        assignedReviewerId: ids.reviewer,
        decisionReason: null,
      });

      await riskResultIn(id);
      const approved = await as('reviewer')
        .post(`/applications/${id}/decision`, { decision: 'APPROVE' })
        .expect(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', businessName: 'Example Roasters' });
    });
  });

  describe('concurrency', () => {
    // The test holds the row lock so all five overlap. With the app's own lock they queue and the
    // rest see a decided application; without it, all five would read SUBMITTED and succeed.
    it('parallel decisions: exactly one wins and only its decision is stored', async () => {
      const id = await awaitingDecision();
      const attempts = [
        { decision: 'APPROVE' },
        { decision: 'REJECT', reason: 'Rejected in parallel 1' },
        { decision: 'REQUEST_INFO', reason: 'Requested in parallel 2' },
        { decision: 'REJECT', reason: 'Rejected in parallel 3' },
        { decision: 'REQUEST_INFO', reason: 'Requested in parallel 4' },
      ];
      const holder = db.createQueryRunner();
      await holder.startTransaction();

      let responses: request.Response[];
      try {
        await holder.query('SELECT id FROM merchant_applications WHERE id = $1 FOR UPDATE', [id]);
        const pending = Promise.all(
          attempts.map((body) => as('reviewer').post(`/applications/${id}/decision`, body)),
        );
        await sleep(300);
        await holder.commitTransaction();
        responses = await pending;
      } finally {
        // An open transaction would block the next suite's TRUNCATE.
        if (holder.isTransactionActive) await holder.rollbackTransaction();
        await holder.release();
      }

      expect(responses.map(({ status }) => status).sort((a, b) => a - b)).toEqual([
        200, 409, 409, 409, 409,
      ]);
      const winner = responses.find(({ status }) => status === 200)!.body as Body;
      expect(await read(id)).toMatchObject({
        status: winner.status,
        decisionReason: winner.decisionReason,
      });
    });
  });

  describe('audit trail', () => {
    interface AuditPage {
      items: { actorId: string; action: string; entityId: string; metadata: object }[];
      total: number;
    }
    const auditOf = async (query: string) =>
      (await as('admin').get(`/audit?${query}`).expect(200)).body as AuditPage;

    it('records who did what, newest first, with no applicant data', async () => {
      const id = await awaitingDecision();
      await as('reviewer')
        .post(`/applications/${id}/decision`, {
          decision: 'REQUEST_INFO',
          reason: 'Please confirm the monthly volume',
        })
        .expect(200);

      const audit = await auditOf(`entityId=${id}`);

      expect(
        audit.items.map(({ actorId, action, metadata }) => ({ actorId, action, metadata })),
      ).toEqual([
        {
          actorId: ids.reviewer,
          action: 'ApplicationDecided',
          metadata: { decision: 'REQUEST_INFO', reason: 'Please confirm the monthly volume' },
        },
        { actorId: ids.admin, action: 'ReviewerAssigned', metadata: { reviewerId: ids.reviewer } },
        { actorId: ids.salesA, action: 'ApplicationSubmitted', metadata: { submissionNo: 1 } },
        { actorId: ids.salesA, action: 'ApplicationCreated', metadata: { createdBy: ids.salesA } },
      ]);
      const { fullName, email, phone } = input.ownerContact;
      for (const value of [fullName, email, phone]) {
        expect(JSON.stringify(audit)).not.toContain(value);
      }
    });

    it('filters by entity and pages', async () => {
      const first = await submittedBy('salesA');
      const other = await submittedBy('salesA');

      const page = await auditOf(`entityId=${first}&limit=1&page=2`);

      expect(page.total).toBe(2);
      expect(page.items).toEqual([
        expect.objectContaining({ entityId: first, action: 'ApplicationCreated' }),
      ]);
      const all = await auditOf('limit=100');
      expect(all.items.map(({ entityId }) => entityId)).toEqual(
        expect.arrayContaining([first, other]),
      );
    });

    it.each<User>(['salesA', 'reviewer'])('%s cannot read the audit log: 403', async (user) => {
      await as(user).get('/audit').expect(403);
    });

    it('rejects a malformed entityId: 400', async () => {
      await as('admin').get('/audit?entityId=not-a-uuid').expect(400);
    });
  });
});
