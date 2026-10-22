import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest, IS_PUBLIC_KEY } from './auth.decorators';
import { AccessTokenClaims } from './jwt-options';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    // Module verify options pin HS256, issuer and audience; expiry is always checked.
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token).catch(() => {
      throw new UnauthorizedException('Invalid or expired token');
    });
    request.user = { id: claims.sub, role: claims.role };
    return true;
  }
}
