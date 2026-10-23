import { Injectable } from '@nestjs/common';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { AuditLogOrmEntity } from './audit-log.orm-entity';

export interface AuditPage {
  items: AuditLogOrmEntity[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class AuditReader {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  // Newest first. Every column is safe to return: metadata was masked when written.
  async list(filter: { entityId?: string; page: number; limit: number }): Promise<AuditPage> {
    const { entityId, page, limit } = filter;
    const [items, total] = await this.uow.manager.findAndCount(AuditLogOrmEntity, {
      where: entityId ? { entityId } : {},
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }
}
