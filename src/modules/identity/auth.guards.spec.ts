import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest, Public, Roles } from '@shared/api/auth.decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { jwtOptions } from './jwt-options';
import { RolesGuard } from './roles.guard';

const SECRET = 'test-only-secret-'.repeat(2);
const USER_ID = '3f1c2b9e-8d4a-4c1e-9f6b-2a7d5e8c0b14';

class TestController {
  @Public()
  open() {}

  @Roles('ADMIN')
  adminOnly() {}

  undeclared() {}
}

function contextFor(handler: keyof TestController, request: Partial<AuthenticatedRequest>) {
  return {
    getHandler: () => (TestController.prototype as unknown as Record<string, unknown>)[handler],
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('JwtAuthGuard', () => {
  const jwt = new JwtService(jwtOptions(SECRET));
  const guard = new JwtAuthGuard(jwt, new Reflector());
  const claims = { sub: USER_ID, role: 'SALES' };

  function requestWith(authorization?: string): Partial<AuthenticatedRequest> {
    return { headers: { authorization } };
  }

  it('lets public routes through without a token', async () => {
    await expect(guard.canActivate(contextFor('open', requestWith()))).resolves.toBe(true);
  });

  it('accepts a valid token and attaches the user', async () => {
    const request = requestWith(`Bearer ${await jwt.signAsync(claims)}`);

    await expect(guard.canActivate(contextFor('adminOnly', request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: USER_ID, role: 'SALES' });
  });

  it.each([
    ['no Authorization header', () => undefined],
    ['a non-Bearer scheme', async () => `Basic ${await jwt.signAsync(claims)}`],
    ['an empty token', () => 'Bearer '],
  ])('rejects %s', async (_case, header) => {
    const context = contextFor('adminOnly', requestWith(await header()));
    await expect(guard.canActivate(context)).rejects.toThrow('Missing bearer token');
  });

  it.each<[string, () => Promise<string>]>([
    [
      'a tampered payload',
      async () => {
        const [header, , signature] = (await jwt.signAsync(claims)).split('.');
        return `${header}.${base64url({ ...claims, role: 'ADMIN' })}.${signature}`;
      },
    ],
    [
      'a different signing key',
      () => jwt.signAsync(claims, { secret: 'another-secret-'.repeat(3) }),
    ],
    ['an expired token', () => jwt.signAsync(claims, { expiresIn: -10 })],
    [
      'alg=none',
      () => Promise.resolve(`${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(claims)}.`),
    ],
    ['another HMAC algorithm', () => jwt.signAsync(claims, { algorithm: 'HS512' })],
    ['the wrong issuer', () => jwt.signAsync(claims, { issuer: 'someone-else' })],
    ['the wrong audience', () => jwt.signAsync(claims, { audience: 'another-api' })],
    ['garbage', () => Promise.resolve('not.a.jwt')],
  ])('rejects %s', async (_case, token) => {
    const request = requestWith(`Bearer ${await token()}`);

    const result = guard.canActivate(contextFor('adminOnly', request));

    await expect(result).rejects.toThrow(UnauthorizedException);
    await expect(result).rejects.toThrow('Invalid or expired token');
    expect(request.user).toBeUndefined();
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it.each<[keyof TestController, AuthenticatedRequest['user'], boolean]>([
    ['open', undefined, true],
    ['adminOnly', { id: USER_ID, role: 'ADMIN' }, true],
    ['adminOnly', { id: USER_ID, role: 'SALES' }, false],
    ['adminOnly', undefined, false],
    ['undeclared', { id: USER_ID, role: 'ADMIN' }, false],
  ])('%s route, user %o → %s', (handler, user, allowed) => {
    expect(guard.canActivate(contextFor(handler, { user }))).toBe(allowed);
  });
});
