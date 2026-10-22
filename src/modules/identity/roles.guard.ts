import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@shared/domain/role';
import { AuthenticatedRequest, IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

// Runs after JwtAuthGuard. Returning false makes Nest respond 403.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    return !!roles && !!user && roles.includes(user.role);
  }
}
