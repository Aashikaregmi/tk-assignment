// What went wrong, not how to report it; the API layer maps each kind to an HTTP status.
export type DomainErrorKind = 'invalid' | 'not_found' | 'forbidden' | 'conflict';

export abstract class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
