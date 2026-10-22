import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS, AccessTokenClaims } from './jwt-options';
import { AccessTokenDto } from './login.dto';
import { PasswordHasher } from './password-hasher';
import { UsersService } from './users.service';

@Injectable()
export class AuthService {
  // Unknown emails are verified against this, so they cost the same as a wrong password.
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordHasher,
    private readonly jwt: JwtService,
  ) {
    this.dummyHash = passwords.hash(randomUUID());
  }

  async login(email: string, password: string): Promise<AccessTokenDto> {
    const user = await this.users.findByEmail(email);
    const valid = await this.passwords.verify(
      user?.passwordHash ?? (await this.dummyHash),
      password,
    );
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');

    const claims: AccessTokenClaims = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(claims),
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
