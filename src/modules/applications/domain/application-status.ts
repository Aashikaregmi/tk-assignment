export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'INFO_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const RISK_STATUSES = ['NOT_STARTED', 'PENDING', 'LOW', 'MEDIUM', 'HIGH', 'FAILED'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

// Every allowed move; anything not listed is rejected. APPROVED and REJECTED are final.
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'INFO_REQUESTED'],
  INFO_REQUESTED: ['SUBMITTED'],
  APPROVED: [],
  REJECTED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const EDITABLE_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'INFO_REQUESTED'];
