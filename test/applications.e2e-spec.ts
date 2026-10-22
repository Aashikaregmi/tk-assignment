import { randomUUID } from 'node:crypto';
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

type User = 'salesA' | 'salesB' | 'reviewer' | 'admin';
const EMAILS: Record<User, string> = {
  salesA: 'sales.one@example.com',
  salesB: 'sales.two@example.com',
  reviewer: 'reviewer.one@example.com',
  admin: 'admin@example.com',
};

interface Body {
  id: string;
  status: string;
  [key: string]: unknown;
}

describe('applications (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = {} as Record<User, string>;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    const password: string = randomUUID();
    await app.get(DataSource).transaction((manager) => seedUsers(manager, password));
    for (const [user, email] of Object.entries(EMAILS) as [User, string][]) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      tokens[user] = (response.body as { accessToken: string }).accessToken;
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
});
