import { randomUUID } from 'node:crypto';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CurrentUser, Roles } from '@shared/api/auth.decorators';
import { TokensResponse } from '@modules/identity/login.dto';
import { seedUsers } from '@modules/identity/seed-users';
import type { Actor } from '@shared/domain/role';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp } from './test-app';

// Test-only routes: the real app has no admin-only endpoint yet.
@Controller('e2e-probe')
class ProbeController {
  @Get('admin')
  @Roles('ADMIN')
  admin(@CurrentUser() user: Actor): Actor {
    return user;
  }

  @Get('undeclared')
  undeclared(): string {
    return 'unreachable';
  }
}

const PROBLEM_JSON = /application\/problem\+json/;

describe('auth (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const password: string = randomUUID();

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController] });
    jwt = app.get(JwtService);
    await app.get(DataSource).transaction((manager) => seedUsers(manager, password));
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const login = (email: string, pass = password) =>
    http().post('/auth/login').send({ email, password: pass });

  async function tokenFor(email: string): Promise<string> {
    const response = await login(email).expect(200);
    return (response.body as TokensResponse).accessToken;
  }

  describe('POST /auth/login', () => {
    it('returns a bearer token for valid credentials, ignoring email case', async () => {
      const response = await login('Admin@Example.com').expect(200);

      expect(response.body).toEqual({
        accessToken: expect.any(String) as string,
        tokenType: 'Bearer',
        expiresIn: 900,
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as string,
        refreshExpiresIn: 604800,
      });
    });

    it('answers a wrong password and an unknown email identically', async () => {
      const wrongPassword = await login('admin@example.com', 'not-the-password').expect(401);
      const unknownEmail = await login('nobody@example.com').expect(401);

      expect(wrongPassword.headers['content-type']).toMatch(PROBLEM_JSON);
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expect(wrongPassword.body).toMatchObject({ detail: 'Invalid email or password' });
    });

    it('rejects unknown fields and invalid input with 400', async () => {
      const response = await http()
        .post('/auth/login')
        .send({ email: 'not-an-email', password, role: 'ADMIN' })
        .expect(400);

      expect(response.body).toMatchObject({
        errors: expect.arrayContaining([
          'property role should not exist',
          'email must be an email',
        ]) as string[],
      });
    });
  });

  describe('protected routes', () => {
    it('lets a logged-in ADMIN through and exposes the current user', async () => {
      const token = await tokenFor('admin@example.com');

      const response = await http()
        .get('/e2e-probe/admin')
        .auth(token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toEqual({ id: expect.any(String) as string, role: 'ADMIN' });
    });

    it('returns 401 without a token', async () => {
      const response = await http().get('/e2e-probe/admin').expect(401);
      expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
      expect(response.body).toMatchObject({ detail: 'Missing bearer token' });
    });

    it.each<[string, () => Promise<string>]>([
      ['garbage', () => Promise.resolve('not.a.jwt')],
      ['expired', () => jwt.signAsync({ sub: randomUUID(), role: 'ADMIN' }, { expiresIn: -10 })],
      [
        'signed with another key',
        () =>
          jwt.signAsync({ sub: randomUUID(), role: 'ADMIN' }, { secret: 'another-key-'.repeat(4) }),
      ],
      [
        'tampered',
        async () => {
          const [header, , signature] = (await tokenFor('sales.one@example.com')).split('.');
          const claims = Buffer.from(JSON.stringify({ sub: randomUUID(), role: 'ADMIN' }));
          return `${header}.${claims.toString('base64url')}.${signature}`;
        },
      ],
    ])('returns 401 for a token that is %s', async (_case, token) => {
      const bearer = await token();
      const response = await http()
        .get('/e2e-probe/admin')
        .auth(bearer, { type: 'bearer' })
        .expect(401);
      expect(response.body).toMatchObject({ detail: 'Invalid or expired token' });
    });

    it('returns 403 for a role the route does not allow', async () => {
      const token = await tokenFor('sales.one@example.com');
      const response = await http()
        .get('/e2e-probe/admin')
        .auth(token, { type: 'bearer' })
        .expect(403);
      expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
    });

    it('returns 403 on a route that declares no roles, even for ADMIN', async () => {
      const token = await tokenFor('admin@example.com');
      await http().get('/e2e-probe/undeclared').auth(token, { type: 'bearer' }).expect(403);
    });
  });

  describe('refresh tokens', () => {
    const tokensFor = async (email: string) =>
      (await login(email).expect(200)).body as TokensResponse;
    const refresh = (refreshToken: unknown) => http().post('/auth/refresh').send({ refreshToken });
    const asAdmin = (accessToken: string) =>
      http().get('/e2e-probe/admin').auth(accessToken, { type: 'bearer' });

    it('refresh returns a new working access token and a new refresh token', async () => {
      const first = await tokensFor('admin@example.com');

      const response = await refresh(first.refreshToken).expect(200);

      const next = response.body as TokensResponse;
      expect(next).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      expect(next.refreshToken).not.toBe(first.refreshToken);
      await asAdmin(next.accessToken).expect(200);
      await refresh(next.refreshToken).expect(200);
    });

    it('a reused refresh token is refused and ends the session, like an unknown one', async () => {
      const first = await tokensFor('admin@example.com');
      const { refreshToken: second } = (await refresh(first.refreshToken).expect(200))
        .body as TokensResponse;

      const reused = await refresh(first.refreshToken).expect(401);

      await refresh(second).expect(401);
      const unknown = await refresh('not-a-token-we-issued').expect(401);
      expect(reused.body).toEqual(unknown.body);
      expect(reused.body).toMatchObject({ detail: 'Invalid refresh token' });
    });

    it('logout ends the session; unknown tokens are accepted too', async () => {
      const { refreshToken } = await tokensFor('admin@example.com');

      await http().post('/auth/logout').send({ refreshToken }).expect(204);
      await http().post('/auth/logout').send({ refreshToken: 'not-a-token-we-issued' }).expect(204);

      await refresh(refreshToken).expect(401);
    });

    it('a role change applies at the next refresh', async () => {
      const db = app.get(DataSource);
      const { refreshToken, accessToken } = await tokensFor('admin@example.com');
      await asAdmin(accessToken).expect(200);
      try {
        await db.query("UPDATE users SET role = 'SALES' WHERE email = 'admin@example.com'");

        const demoted = (await refresh(refreshToken).expect(200)).body as TokensResponse;

        await asAdmin(demoted.accessToken).expect(403);
      } finally {
        await db.query("UPDATE users SET role = 'ADMIN' WHERE email = 'admin@example.com'");
      }
    });

    it.each([
      ['a missing token', {}],
      ['a blank token', { refreshToken: '' }],
      ['a non-string token', { refreshToken: 42 }],
      ['an oversized token', { refreshToken: 'x'.repeat(101) }],
      ['an unknown field', { refreshToken: 'abc', userId: 'x' }],
    ])('rejects %s with 400', async (_case, body) => {
      await http().post('/auth/refresh').send(body).expect(400);
      await http().post('/auth/logout').send(body).expect(400);
    });
  });
});

describe('login rate limit (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ throttleLogin: true });
  });

  afterAll(() => app.close());

  it('allows 5 attempts per minute, then answers 429 with Retry-After', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever' });

    for (let i = 0; i < 5; i++) await attempt().expect(401);
    const limited = await attempt().expect(429);

    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.body).toMatchObject({
      status: 429,
      detail: 'Too many login attempts. Try again later.',
    });
  });
});
