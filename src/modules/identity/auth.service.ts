import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenClaims } from './jwt-options';
import { TokensResponse } from './login.dto';
import { PasswordHasher } from './password-hasher';
import { REFRESH_TOKEN_TTL_SECONDS, RefreshTokenService } from './refresh-token.service';
import { UsersService } from './users.service';

@Injectable()
export class AuthService {
  // Unknown emails are verified against this, so they cost the same as a wrong password.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {
    this.dummyHash = passwords.hash(randomUUID());
  }

  async login(email: string, password: string): Promise<TokensResponse> {
    const user = await this.users.findByEmail(email);
    const valid = await this.passwords.verify(
      user?.passwordHash ?? (await this.dummyHash),
      password,
    );
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');

    return this.tokensFor(user.id, user.role, await this.refreshTokens.issue(user.id));
  }

  // The role is read again here, so a role change applies from the next refresh.
  async refresh(refreshToken: string): Promise<TokensResponse> {
    const { userId, refreshToken: next } = await this.refreshTokens.rotate(refreshToken);
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return this.tokensFor(user.id, user.role, next);
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revoke(refreshToken);
  }

  private async tokensFor(
    userId: string,
    role: AccessTokenClaims['role'],
    refreshToken: string,
  ): Promise<TokensResponse> {
    const claims: AccessTokenClaims = { sub: userId, role };
    return {
      accessToken: await this.jwt.signAsync(claims),
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    };
  }
}
