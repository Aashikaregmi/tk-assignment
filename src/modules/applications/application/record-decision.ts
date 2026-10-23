import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UnitOfWork } from '@shared/application/unit-of-work';
import type { Actor } from '@shared/domain/role';
import { assertCanRead } from '../domain/access-policy';
import type { Decision } from '../domain/application-status';
import { ApplicationNotFound } from '../domain/errors';
import { ApplicationRepository } from './application-repository';
import { DomainEventPublisher } from './domain-event-publisher';

export class RecordDecisionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly decision: Decision,
    readonly reason?: string,
  ) {
    super();
  }
}

@CommandHandler(RecordDecisionCommand)
export class RecordDecisionHandler implements ICommandHandler<RecordDecisionCommand> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly applications: ApplicationRepository,
    private readonly events: DomainEventPublisher,
  ) {}

  // The row lock makes concurrent decisions queue: the second sees the first's result.
  execute({ actor, id, decision, reason }: RecordDecisionCommand): Promise<void> {
    return this.uow.run(async () => {
      const application = await this.applications.findByIdForUpdate(id);
      if (!application) throw new ApplicationNotFound();
      assertCanRead(actor, application);
      application.decide(actor, decision, reason);
      await this.applications.save(application);
      await this.events.publish(actor.id, application.pullEvents());
    });
  }
}
