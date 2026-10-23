import type { RiskResult } from '../domain/application-status';

export interface RiskReview {
  applicationId: string;
  submissionNo: number;
  result: RiskResult | 'FAILED';
  // The provider's score; null when the review failed.
  score: number | null;
}

// Port: the outcome of each submission's risk review, kept alongside the application's status.
export abstract class RiskReviewRepository {
  abstract add(review: RiskReview): Promise<void>;
}
