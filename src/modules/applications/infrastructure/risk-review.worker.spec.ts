import { CommandBus } from '@nestjs/cqrs';
import { Queues } from '@shared/infrastructure/queue/queues';
import type { Job } from 'bullmq';
import { FailRiskReviewCommand } from '../application/fail-risk-review';
import { ProcessRiskReviewCommand } from '../application/process-risk-review';
import { RiskReviewWorker } from './risk-review.worker';
import type { RiskReviewJob } from './risk-review-queue';

const job = (attemptsMade: number) =>
  ({
    id: 'job-1',
    data: { applicationId: 'app-1', submissionNo: 2 },
    attemptsMade,
    opts: { attempts: 5 },
  }) as Job<RiskReviewJob>;

describe('RiskReviewWorker.process', () => {
  let execute: jest.Mock;
  let worker: RiskReviewWorker;

  beforeEach(() => {
    execute = jest.fn();
    worker = new RiskReviewWorker(
      { execute } as unknown as CommandBus,
      {
        define: jest.fn(),
      } as unknown as Queues,
    );
  });

  it('runs the review for the job’s submission', async () => {
    execute.mockResolvedValue(undefined);

    await worker.process(job(0));

    expect(execute).toHaveBeenCalledWith(new ProcessRiskReviewCommand('app-1', 2));
  });

  it.each([0, 3])('after %i earlier failures, rethrows so BullMQ retries', async (attemptsMade) => {
    execute.mockRejectedValue(new Error('provider down'));

    await expect(worker.process(job(attemptsMade))).rejects.toThrow('provider down');

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('on the last attempt, marks the review FAILED and completes the job', async () => {
    execute.mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce(undefined);

    await expect(worker.process(job(4))).resolves.toBeUndefined();

    expect(execute).toHaveBeenLastCalledWith(new FailRiskReviewCommand('app-1', 2));
  });
});
