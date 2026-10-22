import { DomainError } from '@shared/domain/domain-error';
import type { ApplicationStatus } from './application-status';

// Messages name the field, never the value: values may be personal data.
export class InvalidApplicationData extends DomainError {
  constructor(message: string) {
    super('invalid', 'INVALID_APPLICATION_DATA', message);
  }
}

export class InvalidStatusTransition extends DomainError {
  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(
      'conflict',
      'INVALID_STATUS_TRANSITION',
      `Cannot move an application from ${from} to ${to}`,
    );
  }
}

export class ApplicationNotEditable extends DomainError {
  constructor(status: ApplicationStatus) {
    super('conflict', 'APPLICATION_NOT_EDITABLE', `An application in ${status} cannot be edited`);
  }
}

// Also used for applications the actor may not see, so their existence isn't revealed.
export class ApplicationNotFound extends DomainError {
  constructor() {
    super('not_found', 'APPLICATION_NOT_FOUND', 'Application not found');
  }
}

export class ApplicationAccessDenied extends DomainError {
  constructor(action: string) {
    super('forbidden', 'APPLICATION_ACCESS_DENIED', `Your role cannot ${action} applications`);
  }
}
