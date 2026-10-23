import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UnitOfWork } from '@shared/application/unit-of-work';
import type { Actor } from '@shared/domain/role';
import { assertCanEdit } from '../domain/access-policy';
import { ApplicationNotFound } from '../domain/errors';
import { ApplicationRepository } from './application-repository';
import { DomainEventPublisher } from './domain-event-publisher';

export class SubmitApplicationCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

@CommandHandler(SubmitApplicationCommand)
export class SubmitApplicationHandler implements ICommandHandler<SubmitApplicationCommand> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly applications: ApplicationRepository,
    private readonly events: DomainEventPublisher,
  ) {}

  execute({ actor, id }: SubmitApplicationCommand): Promise<void> {
    return this.uow.run(async () => {
      const application = await this.applications.findByIdForUpdate(id);
      if (!application) throw new ApplicationNotFound();
      assertCanEdit(actor, application);
      application.submit();
      await this.applications.save(application);
      await this.events.publish(actor.id, application.pullEvents());
    });
  }
}
