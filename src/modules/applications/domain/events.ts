import type { DomainEvent } from '@shared/domain/aggregate-root';

// Events carry ids and field names only.
export interface ApplicationCreated extends DomainEvent {
  readonly type: 'ApplicationCreated';
  readonly createdBy: string;
}

export interface ApplicationUpdated extends DomainEvent {
  readonly type: 'ApplicationUpdated';
  readonly fields: readonly string[];
}

export interface ApplicationSubmitted extends DomainEvent {
  readonly type: 'ApplicationSubmitted';
  // Identifies this submission, so the risk review of an older one can be recognized as stale.
  readonly submissionNo: number;
}

export type ApplicationEvent = ApplicationCreated | ApplicationUpdated | ApplicationSubmitted;
