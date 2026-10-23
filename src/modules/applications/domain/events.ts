import type { DomainEvent } from '@shared/domain/aggregate-root';
import type { Decision } from './application-status';

// Events carry ids and field names, never applicant data.
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

export interface ReviewerAssigned extends DomainEvent {
  readonly type: 'ReviewerAssigned';
  readonly reviewerId: string;
}

// The reason is the reviewer's text; the event keeps it after a resubmission clears it.
export interface ApplicationDecided extends DomainEvent {
  readonly type: 'ApplicationDecided';
  readonly decision: Decision;
  readonly reason: string | null;
}

export type ApplicationEvent =
  | ApplicationCreated
  | ApplicationUpdated
  | ApplicationSubmitted
  | ReviewerAssigned
  | ApplicationDecided;
