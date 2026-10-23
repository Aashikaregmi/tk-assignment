import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Queues } from '@shared/infrastructure/queue/queues';
import { Job, Worker } from 'bullmq';
import { FailRiskReviewCommand } from '../application/fail-risk-review';
import { ProcessRiskReviewCommand } from '../application/process-risk-review';
import { RISK_REVIEW_JOB_OPTIONS, RISK_REVIEW_QUEUE, RiskReviewJob } from './risk-review-queue';

@Injectable()
export class RiskReviewWorker implements BeforeApplicationShutdown {
  private readonly logger = new Logger(RiskReviewWorker.name);
  private worker?: Worker<RiskReviewJob>;

  constructor(
    private readonly commands: CommandBus,
    private readonly queues: Queues,
  ) {
    queues.define(RISK_REVIEW_QUEUE, RISK_REVIEW_JOB_OPTIONS);
  }

  // Called from main.ts, like the outbox relay, so test apps don't consume jobs on their own.
  start(): void {
    // Several reviews at once: each mostly waits on the provider.
    this.worker ??= new Worker(RISK_REVIEW_QUEUE, (job) => this.process(job), {
      connection: this.queues.connection,
      concurrency: 5,
    });
  }

  // Lets running jobs finish; before the database and queues close.
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  // On the last attempt a failure is final: mark the review FAILED here, inside the job, rather than
  // in a 'failed' listener, so BullMQ's stalled-job recovery still covers it if the process dies.
  async process({ id, data, attemptsMade, opts }: Job<RiskReviewJob>): Promise<void> {
    const { applicationId, submissionNo } = data;
    try {
      await this.commands.execute(new ProcessRiskReviewCommand(applicationId, submissionNo));
    } catch (error) {
      const attempt = attemptsMade + 1;
      const final = attempt >= (opts.attempts ?? 1);
      this.logger.warn(
        `Risk review job ${id} attempt ${attempt} failed${final ? ', marking FAILED' : ''}: ${(error as Error).message}`,
      );
      if (!final) throw error;
      await this.commands.execute(new FailRiskReviewCommand(applicationId, submissionNo));
    }
  }
}
