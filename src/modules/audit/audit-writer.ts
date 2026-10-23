import { Injectable } from '@nestjs/common';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { maskDeep } from '@shared/infrastructure/sensitive-data';
import { AuditLogOrmEntity } from './audit-log.orm-entity';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditWriter {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  // Inside a unit of work this joins its transaction: the entry commits or rolls back with the change.
  async write(entry: AuditEntry): Promise<void> {
    await this.uow.manager.save(AuditLogOrmEntity, {
      ...entry,
      // Masked by key, as in logs. Free text under an unlisted key is stored as given.
      metadata: maskDeep(entry.metadata ?? {}) as Record<string, unknown>,
    });
  }
}
