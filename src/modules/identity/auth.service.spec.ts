import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { jwtOptions } from './jwt-options';
import { PasswordHasher } from './password-hasher';
import { UserOrmEntity } from './user.orm-entity';
import { UsersService } from './users.service';

const PASSWORD = 'correct horse battery staple';

describe('AuthService', () => {
  const hasher = new PasswordHasher();
  const jwt = new JwtService(jwtOptions('test-only-secret-'.repeat(2)));
  let auth: AuthService;
  let user: UserOrmEntity;

  beforeAll(async () => {
    user = {
      id: '3f1c2b9e-8d4a-4c1e-9f6b-2a7d5e8c0b14',
      email: 'sales.one@example.com',
      role: 'SALES',
      passwordHash: await hasher.hash(PASSWORD),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const users = {
      findByEmail: (email: string) => Promise.resolve(email === user.email ? user : null),
    };
    auth = new AuthService(users as unknown as UsersService, hasher, jwt);
  });

  afterEach(() => jest.restoreAllMocks());

  it('issues a 15-minute HS256 access token with sub, role, iss and aud', async () => {
    const result = await auth.login(user.email, PASSWORD);

    expect(result).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    const claims = await jwt.verifyAsync<Record<string, unknown>>(result.accessToken);
    expect(claims).toMatchObject({
      sub: user.id,
      role: 'SALES',
      iss: 'vizypay-auth',
      aud: 'vizypay-merchant-api',
    });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(900);
    expect(
      jwt.decode<{ header: { alg: string } }>(result.accessToken, { complete: true }).header.alg,
    ).toBe('HS256');
  });

  it.each([
    ['a wrong password', 'sales.one@example.com', 'wrong password'],
    ['an unknown email', 'nobody@example.com', PASSWORD],
  ])('rejects %s with the same 401', async (_case, email, password) => {
    const error = await auth.login(email, password).then(
      () => undefined,
      (rejection: unknown) => rejection,
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid email or password',
    });
  });

  it('still runs an argon2 verify for unknown emails', async () => {
    const verify = jest.spyOn(hasher, 'verify');

    await auth.login('nobody@example.com', PASSWORD).catch(() => undefined);

    expect(verify).toHaveBeenCalledWith(expect.stringMatching(/^\$argon2id\$/), PASSWORD);
  });
});
