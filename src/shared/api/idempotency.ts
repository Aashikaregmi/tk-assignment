import { createHash } from 'node:crypto';
import {
  applyDecorators,
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { IdempotencyStore } from '../application/idempotency-store';
import { UnitOfWork } from '../application/unit-of-work';
import type { AuthenticatedRequest } from './auth.decorators';

const IDEMPOTENT_KEY = 'idempotent';
const KEY_FORMAT = /^[\x21-\x7e]{1,255}$/;

// Safe to retry with an Idempotency-Key header: a repeat gets the first response, not a second effect.
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'Up to 255 visible ASCII characters, unique per request you mean to make once. A retry with the same key and body replays the first response; a different body is 422.',
    }),
  );

// Method, path and body. Object keys are sorted, so property order doesn't count as a change.
export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([method, path, sorted(body ?? null)]))
    .digest('hex');
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
  );
}

// Global; acts only on @Idempotent() routes that carry the header. The key row, the command and
// the stored response share one transaction: a failure rolls the key back, so the client can retry.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly uow: UnitOfWork,
    private readonly store: IdempotencyStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = request.header('idempotency-key');
    const idempotent = this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler());
    if (!idempotent || key === undefined || !request.user) return next.handle();
    if (!KEY_FORMAT.test(key)) {
      throw new BadRequestException('Idempotency-Key must be 1 to 255 visible ASCII characters');
    }

    const userId = request.user.id;
    const requestHash = fingerprint(request.method, request.path, request.body);
    return from(
      this.uow.run(async () => {
        const earlier = await this.store.claim(userId, key, requestHash);
        if (earlier) {
          if (earlier.requestHash !== requestHash) {
            throw new UnprocessableEntityException(
              'Idempotency-Key was already used for a different request',
            );
          }
          context.switchToHttp().getResponse<Response>().setHeader('Idempotent-Replayed', 'true');
          return earlier.responseBody;
        }
        // Called inside run(), so the handler's commands join this transaction.
        const body = await lastValueFrom(next.handle());
        await this.store.complete(userId, key, body);
        return body;
      }),
    );
  }
}
