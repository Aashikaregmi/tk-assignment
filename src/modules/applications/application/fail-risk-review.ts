import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UnitOfWork } from '@shared/application/unit-of-work';
import { ApplicationRepository } from './application-repository';
import { DomainEventPublisher } from './domain-event-publisher';
import { RiskReviewRepository } from './risk-review-repository';

// From the risk-review worker once every retry has failed.
export class FailRiskReviewCommand extends Command<void> {
  constructor(
    readonly applicationId: string,
    readonly submissionNo: number,
  ) {
    super();
  }
}

@CommandHandler(FailRiskReviewCommand)
export class FailRiskReviewHandler implements ICommandHandler<FailRiskReviewCommand> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly applications: ApplicationRepository,
    private readonly reviews: RiskReviewRepository,
    private readonly events: DomainEventPublisher,
  ) {}

  execute({ applicationId, submissionNo }: FailRiskReviewCommand): Promise<void> {
    return this.uow.run(async () => {
      const application = await this.applications.findByIdForUpdate(applicationId);
      if (!application) return;
      application.markRiskFailed(submissionNo);
      const events = application.pullEvents();
      if (events.length === 0) return;
      await this.applications.save(application);
      await this.reviews.add({ applicationId, submissionNo, result: 'FAILED', score: null });
      await this.events.publish(null, events);
    });
  }
}
