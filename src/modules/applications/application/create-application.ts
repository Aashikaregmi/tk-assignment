import { randomUUID } from 'node:crypto';
import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UnitOfWork } from '@shared/application/unit-of-work';
import type { Actor } from '@shared/domain/role';
import { assertCanCreate } from '../domain/access-policy';
import { MerchantApplication } from '../domain/merchant-application';
import { ApplicationDetailsInput, toDetails } from './application-input';
import { ApplicationRepository } from './application-repository';

export class CreateApplicationCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly details: ApplicationDetailsInput,
  ) {
    super();
  }
}

@CommandHandler(CreateApplicationCommand)
export class CreateApplicationHandler implements ICommandHandler<CreateApplicationCommand> {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly applications: ApplicationRepository,
  ) {}

  execute({ actor, details }: CreateApplicationCommand): Promise<{ id: string }> {
    assertCanCreate(actor);
    return this.uow.run(async () => {
      const application = MerchantApplication.create(randomUUID(), actor.id, toDetails(details));
      await this.applications.save(application);
      return { id: application.id };
    });
  }
}
