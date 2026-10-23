import type { RiskResult } from '../domain/application-status';
import type { BusinessType } from '../domain/merchant-application';

// Business and processing details only: the owner's contact details never leave us.
export interface RiskAssessmentRequest {
  legalBusinessName: string;
  businessType: BusinessType;
  mcc: string;
  monthlyVolumeCents: number;
  averageTicketCents: number;
}

export interface RiskAssessment {
  result: RiskResult;
  // 0–100, higher is riskier; kept with the review as the provider's evidence.
  score: number;
}

// Port: an external KYB/risk provider. Simulated in S38.
export abstract class RiskProvider {
  // The same key returns the provider's earlier answer instead of a new (billed) check.
  abstract assess(request: RiskAssessmentRequest, idempotencyKey: string): Promise<RiskAssessment>;
}
