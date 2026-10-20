import { STATUS_CODES } from 'node:http';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { DomainError, DomainErrorKind } from '../domain/domain-error';

// RFC 9457. `code` and `errors` are extension members.
export interface ProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  detail?: string;
  code?: string;
  errors?: string[];
}

const STATUS_BY_KIND: Record<DomainErrorKind, HttpStatus> = {
  invalid: HttpStatus.UNPROCESSABLE_ENTITY,
  not_found: HttpStatus.NOT_FOUND,
  forbidden: HttpStatus.FORBIDDEN,
  conflict: HttpStatus.CONFLICT,
};

const PG_UNIQUE_VIOLATION = '23505';

export function toProblem(exception: unknown): ProblemDetails {
  if (exception instanceof DomainError) {
    return problem(STATUS_BY_KIND[exception.kind], {
      detail: exception.message,
      code: exception.code,
    });
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return problem(status);
    const response = exception.getResponse();
    const message =
      typeof response === 'string' ? response : (response as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return problem(status, { detail: 'Request validation failed.', errors: message.map(String) });
    }
    return problem(status, { detail: typeof message === 'string' ? message : exception.message });
  }

  // Backstop for races the handlers' checks can't see. Constraint names and values stay server-side.
  if (
    exception instanceof QueryFailedError &&
    (exception.driverError as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  ) {
    return problem(HttpStatus.CONFLICT, {
      detail: 'The request conflicts with an existing resource.',
    });
  }

  return problem(HttpStatus.INTERNAL_SERVER_ERROR);
}

function problem(status: number, members: Partial<ProblemDetails> = {}): ProblemDetails {
  return { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, ...members };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = toProblem(exception);
    if (body.status >= 500) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      // Message and stack only: driver errors carry the query and its parameters as properties.
      this.logger.error(error.message, error.stack);
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(body.status)
      .type('application/problem+json')
      .json(body);
  }
}
