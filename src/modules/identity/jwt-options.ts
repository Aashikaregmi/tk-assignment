import { JwtModuleOptions } from '@nestjs/jwt';
import type { Role } from '@shared/domain/role';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = 'vizypay-auth';
const AUDIENCE = 'vizypay-merchant-api';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
}

// Algorithm pinned on verify too, so alg=none and non-HS256 tokens are rejected.
export function jwtOptions(secret: string): JwtModuleOptions {
  return {
    secret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    },
    verifyOptions: { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE },
  };
}
