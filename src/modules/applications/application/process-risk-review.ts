import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UnitOfWork } from '@shared/application/unit-of-work';
import { ApplicationRepository } from './application-repository';
import { DomainEventPublisher } from './domain-event-publisher';
import { RiskProvider } from './risk-provider';
import { RiskReviewRepository } from './risk-review-repository';

// From the risk-review queue: one job per submission.
export class ProcessRiskReviewCommand extends Command<void> {
  constructor(
    readonly applicationId: string,
    readonly submissionNo: number,
  ) {
    super();
  }
}

@CommandHandler(ProcessRiskReviewCommand)
export class ProcessRiskReviewHandler implements ICommandHandler<ProcessRiskReviewCommand> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly applications: ApplicationRepository,
    private readonly provider: RiskProvider,
    private readonly reviews: RiskReviewRepository,
    private readonly events: DomainEventPublisher,
  ) {}

  async execute({ applicationId, submissionNo }: ProcessRiskReviewCommand): Promise<void> {
    // Duplicate or stale job: skip before paying for a provider call.
    const snapshot = await this.applications.findById(applicationId);
    if (!snapshot?.awaitsRiskReview(submissionNo)) return;

    // Outside any transaction: no row lock is held while a third party responds.
    const { legalBusinessName, businessType, processingInfo } = snapshot.toState();
    const { result, score } = await this.provider.assess(
      { legalBusinessName, businessType, ...processingInfo },
      `${applicationId}:${submissionNo}`,
    );

    // The aggregate re-checks under the lock; a resubmission during the call makes this a no-op.
    await this.uow.run(async () => {
      const application = await this.applications.findByIdForUpdate(applicationId);
      if (!application) return;
      application.recordRiskResult(submissionNo, result);
      const events = application.pullEvents();
      if (events.length === 0) return;
      await this.applications.save(application);
      await this.reviews.add({ applicationId, submissionNo, result, score });
      await this.events.publish(null, events);
    });
  }
}
