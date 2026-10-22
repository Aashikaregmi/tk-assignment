import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UnitOfWork } from '@shared/application/unit-of-work';
import type { Actor } from '@shared/domain/role';
import { assertCanAssign } from '../domain/access-policy';
import { ApplicationNotFound, InvalidReviewer } from '../domain/errors';
import { ApplicationRepository } from './application-repository';
import { ReviewerDirectory } from './reviewer-directory';

export class AssignReviewerCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly reviewerId: string,
  ) {
    super();
  }
}

@CommandHandler(AssignReviewerCommand)
export class AssignReviewerHandler implements ICommandHandler<AssignReviewerCommand> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly applications: ApplicationRepository,
    private readonly reviewers: ReviewerDirectory,
  ) {}

  execute({ actor, id, reviewerId }: AssignReviewerCommand): Promise<void> {
    return this.uow.run(async () => {
      const application = await this.applications.findByIdForUpdate(id);
      if (!application) throw new ApplicationNotFound();
      // Access first, so only ADMIN learns which ids are reviewers.
      assertCanAssign(actor, application);
      if (!(await this.reviewers.isReviewer(reviewerId))) throw new InvalidReviewer();
      application.assignReviewer(reviewerId);
      await this.applications.save(application);
    });
  }
}
