import type { DefaultJobOptions } from 'bullmq';

export const RISK_REVIEW_QUEUE = 'risk-review';

export interface RiskReviewJob {
  applicationId: string;
  submissionNo: number;
}

export const RISK_REVIEW_JOB_OPTIONS: DefaultJobOptions = {
  // Waits 1 s, 2 s, 4 s, 8 s between the five attempts; then the review is marked FAILED.
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  // Finished jobs are kept a while, so a re-sent outbox row with the same jobId is still ignored.
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
