import { DomainError } from '@shared/domain/domain-error';

// Messages name the field, never the value: values may be personal data.
export class InvalidApplicationData extends DomainError {
  constructor(message: string) {
    super('invalid', 'INVALID_APPLICATION_DATA', message);
  }
}
