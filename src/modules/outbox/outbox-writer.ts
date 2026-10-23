import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { OutboxOrmEntity } from './outbox.orm-entity';

export interface OutboxMessage {
  queue: string;
  type: string;
  // Ids only: queues live in Redis, which never gets applicant data.
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxWriter {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  // Inside a unit of work: the message exists only if the change commits.
  async write(message: OutboxMessage): Promise<void> {
    await this.uow.manager.save(OutboxOrmEntity, { id: randomUUID(), ...message });
  }
}
