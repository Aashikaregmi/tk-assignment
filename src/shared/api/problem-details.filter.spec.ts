import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { DomainError, DomainErrorKind } from '../domain/domain-error';
import { ProblemDetailsFilter, toProblem } from './problem-details.filter';

class TestDomainError extends DomainError {
  constructor(kind: DomainErrorKind) {
    super(kind, 'TEST_CODE', 'Something specific went wrong');
  }
}

// Shaped like a pg error wrapped by TypeORM; fake values only.
function queryFailed(code: string): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate key value violates "uq_users_email"'), {
    code,
    detail: 'Key (email)=(jane@example.com) already exists.',
  });
  return new QueryFailedError('INSERT INTO users ...', ['jane@example.com'], driverError);
}

describe('toProblem', () => {
  it.each<[DomainErrorKind, number, string]>([
    ['invalid', 422, 'Unprocessable Entity'],
    ['not_found', 404, 'Not Found'],
    ['forbidden', 403, 'Forbidden'],
    ['conflict', 409, 'Conflict'],
  ])('maps DomainError kind %s to %i', (kind, status, title) => {
    expect(toProblem(new TestDomainError(kind))).toEqual({
      type: 'about:blank',
      title,
      status,
      detail: 'Something specific went wrong',
      code: 'TEST_CODE',
    });
  });

  it('passes HttpException status and message through', () => {
    expect(toProblem(new NotFoundException('Application not found'))).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Application not found',
    });
    expect(toProblem(new UnauthorizedException())).toMatchObject({
      status: 401,
      detail: 'Unauthorized',
    });
  });

  it('lists validation messages from ValidationPipe', () => {
    const pipeError = new BadRequestException(['property role should not exist']);
    expect(toProblem(pipeError)).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Request validation failed.',
      errors: ['property role should not exist'],
    });
  });

  it('hides the message of a 5xx HttpException', () => {
    const error = new HttpException(
      'upstream said: secret-internal-detail',
      HttpStatus.BAD_GATEWAY,
    );
    expect(toProblem(error)).toEqual({ type: 'about:blank', title: 'Bad Gateway', status: 502 });
  });

  it('maps a unique violation to 409 without the constraint or values', () => {
    const body = toProblem(queryFailed('23505'));
    expect(body).toMatchObject({ status: 409, title: 'Conflict' });
    expect(JSON.stringify(body)).not.toMatch(/jane@example\.com|uq_users_email|INSERT/);
  });

  it.each([
    ['other database errors', queryFailed('23503')],
    ['unknown errors', new Error('connect ECONNREFUSED 10.0.0.5:5432')],
    ['non-error throws', 'raw string'],
  ])('maps %s to a bare 500', (_case, exception) => {
    expect(toProblem(exception)).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
    });
  });
});

describe('ProblemDetailsFilter', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  function respond(exception: unknown) {
    const response = { status: jest.fn(), type: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    const host = { switchToHttp: () => ({ getResponse: () => response }) };
    new ProblemDetailsFilter().catch(exception, host as unknown as ArgumentsHost);
    return response;
  }

  it('responds with application/problem+json and logs 5xx without query parameters', () => {
    const response = respond(queryFailed('23503'));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('jane@example.com');
  });

  it('does not log 4xx responses', () => {
    expect(respond(new NotFoundException()).status).toHaveBeenCalledWith(404);
    expect(log).not.toHaveBeenCalled();
  });
});
