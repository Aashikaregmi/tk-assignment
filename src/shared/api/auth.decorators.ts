import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor, Role } from '@shared/domain/role';

// Shared, not in identity: every module's controllers use them, and identity's guards read them.
export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export type AuthenticatedRequest = Request & { user?: Actor };

// Skips authentication. Every other route requires a valid access token.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Roles allowed on a route. A non-public route without @Roles is denied.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
