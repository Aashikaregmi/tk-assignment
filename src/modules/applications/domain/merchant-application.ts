import { AggregateRoot } from '@shared/domain/aggregate-root';
import type { Actor } from '@shared/domain/role';
import {
  ApplicationStatus,
  canTransition,
  Decision,
  DECISION_OUTCOMES,
  EDITABLE_STATUSES,
  RISK_RESULTS,
  RiskResult,
  RiskStatus,
} from './application-status';
import {
  ApplicationNotAssignable,
  ApplicationNotEditable,
  InvalidApplicationData,
  InvalidStatusTransition,
  NotAssignedReviewer,
  RiskResultRequired,
} from './errors';
import type { ApplicationEvent } from './events';
import type { OwnerContact } from './owner-contact';
import type { ProcessingInfo } from './processing-info';

export const BUSINESS_TYPES = [
  'SOLE_PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLC',
  'CORPORATION',
  'NON_PROFIT',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

// What SALES fills in; everything else is owned by the lifecycle.
export interface ApplicationDetails {
  businessName: string;
  legalBusinessName: string;
  businessType: BusinessType;
  ownerContact: OwnerContact;
  processingInfo: ProcessingInfo;
}

export interface MerchantApplicationState extends ApplicationDetails {
  id: string;
  createdBy: string;
  status: ApplicationStatus;
  riskStatus: RiskStatus;
  assignedReviewerId: string | null;
  submissionNo: number;
  // Why the current decision was made; null while undecided.
  decisionReason: string | null;
}

export class MerchantApplication extends AggregateRoot<ApplicationEvent> {
  private constructor(private state: MerchantApplicationState) {
    super();
  }

  // The id is passed in: generating it would need Node's crypto, which the domain doesn't import.
  static create(id: string, createdBy: string, details: ApplicationDetails): MerchantApplication {
    const application = new MerchantApplication({
      ...checked(details),
      id,
      createdBy,
      status: 'DRAFT',
      riskStatus: 'NOT_STARTED',
      assignedReviewerId: null,
      submissionNo: 0,
      decisionReason: null,
    });
    application.record({ type: 'ApplicationCreated', aggregateId: id, createdBy });
    return application;
  }

  // Rebuilds a stored application; records no events.
  static reconstitute(state: MerchantApplicationState): MerchantApplication {
    return new MerchantApplication({ ...state });
  }

  get id(): string {
    return this.state.id;
  }

  get createdBy(): string {
    return this.state.createdBy;
  }

  get status(): ApplicationStatus {
    return this.state.status;
  }

  toState(): MerchantApplicationState {
    return { ...this.state };
  }

  update(changes: Partial<ApplicationDetails>): void {
    if (!EDITABLE_STATUSES.includes(this.state.status)) {
      throw new ApplicationNotEditable(this.state.status);
    }
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    ) as Partial<ApplicationDetails>;
    const fields = Object.keys(defined);
    if (fields.length === 0) return;

    this.state = { ...this.state, ...checked({ ...this.state, ...defined }) };
    this.record({ type: 'ApplicationUpdated', aggregateId: this.id, fields });
  }

  // From DRAFT, or INFO_REQUESTED after edits. Starts a new risk review.
  submit(): void {
    this.assertCanMoveTo('SUBMITTED');
    this.state.status = 'SUBMITTED';
    this.state.riskStatus = 'PENDING';
    this.state.submissionNo += 1;
    this.state.decisionReason = null;
    this.record({
      type: 'ApplicationSubmitted',
      aggregateId: this.id,
      submissionNo: this.state.submissionNo,
    });
  }

  // Until decided, the reviewer can be replaced.
  assignReviewer(reviewerId: string): void {
    if (this.state.status !== 'SUBMITTED') throw new ApplicationNotAssignable(this.state.status);
    if (this.state.assignedReviewerId === reviewerId) return;
    this.state.assignedReviewerId = reviewerId;
    this.record({ type: 'ReviewerAssigned', aggregateId: this.id, reviewerId });
  }

  // Only the assigned reviewer decides; ADMIN can't. Needs a finished risk review.
  decide(actor: Actor, decision: Decision, reason?: string): void {
    if (actor.role !== 'REVIEWER' || actor.id !== this.state.assignedReviewerId) {
      throw new NotAssignedReviewer();
    }
    const next = DECISION_OUTCOMES[decision];
    this.assertCanMoveTo(next);
    // A failed review can be rejected or sent back (resubmitting reruns it), never approved.
    const usable: readonly RiskStatus[] =
      decision === 'APPROVE' ? RISK_RESULTS : [...RISK_RESULTS, 'FAILED'];
    if (!usable.includes(this.state.riskStatus)) {
      throw new RiskResultRequired(decision, this.state.riskStatus);
    }
    const decisionReason = checkedReason(decision, reason);

    this.state.status = next;
    this.state.decisionReason = decisionReason;
    this.record({
      type: 'ApplicationDecided',
      aggregateId: this.id,
      decision,
      reason: decisionReason,
    });
  }

  // From the risk worker. Applies only to the current submission while its review is pending, so a
  // result for an older submission (resubmitted since) or a repeated delivery changes nothing.
  recordRiskResult(submissionNo: number, result: RiskResult): void {
    if (!this.awaitsRiskReview(submissionNo)) return;
    this.state.riskStatus = result;
    this.record({ type: 'RiskReviewCompleted', aggregateId: this.id, submissionNo, result });
  }

  // Retries exhausted. A failed review can still be rejected or sent back, never approved.
  markRiskFailed(submissionNo: number): void {
    if (!this.awaitsRiskReview(submissionNo)) return;
    this.state.riskStatus = 'FAILED';
    this.record({ type: 'RiskReviewFailed', aggregateId: this.id, submissionNo });
  }

  private awaitsRiskReview(submissionNo: number): boolean {
    return submissionNo === this.state.submissionNo && this.state.riskStatus === 'PENDING';
  }

  private assertCanMoveTo(next: ApplicationStatus): void {
    if (!canTransition(this.state.status, next)) {
      throw new InvalidStatusTransition(this.state.status, next);
    }
  }
}

function checked(details: ApplicationDetails): ApplicationDetails {
  const businessName = details.businessName.trim();
  const legalBusinessName = details.legalBusinessName.trim();
  if (businessName.length === 0 || businessName.length > 200) {
    throw new InvalidApplicationData('businessName must be 1 to 200 characters');
  }
  if (legalBusinessName.length === 0 || legalBusinessName.length > 200) {
    throw new InvalidApplicationData('legalBusinessName must be 1 to 200 characters');
  }
  if (!BUSINESS_TYPES.includes(details.businessType)) {
    throw new InvalidApplicationData(`businessType must be one of ${BUSINESS_TYPES.join(', ')}`);
  }
  return {
    businessName,
    legalBusinessName,
    businessType: details.businessType,
    ownerContact: details.ownerContact,
    processingInfo: details.processingInfo,
  };
}

// Rejections and info requests must say why; a note on an approval is optional.
function checkedReason(decision: Decision, reason: string | undefined): string | null {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length > 1000) {
    throw new InvalidApplicationData('reason must be at most 1000 characters');
  }
  if (trimmed.length > 0) return trimmed;
  if (decision === 'APPROVE') return null;
  throw new InvalidApplicationData(`reason is required to ${decision}`);
}
