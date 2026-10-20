import { DomainError } from './domain-error';

class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('conflict', 'INVALID_TRANSITION', `Cannot move from ${from} to ${to}`);
  }
}

describe('DomainError', () => {
  it('carries kind, code, message and the subclass name', () => {
    const error = new InvalidTransitionError('APPROVED', 'DRAFT');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      kind: 'conflict',
      code: 'INVALID_TRANSITION',
      message: 'Cannot move from APPROVED to DRAFT',
      name: 'InvalidTransitionError',
    });
  });
});
