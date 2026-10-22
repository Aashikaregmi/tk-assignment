import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { Actor } from '@shared/domain/role';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { EntityManager, SelectQueryBuilder } from 'typeorm';
import {
  ApplicationView,
  GetApplicationQuery,
  ListApplicationsQuery,
  MAX_PAGE_SIZE,
  Page,
} from '../application/application-queries';
import { readScopeFor } from '../domain/access-policy';
import { ApplicationNotFound } from '../domain/errors';
import { ApplicationOrmEntity } from './application.orm-entity';

// The access policy's read scope as SQL; the single source for what each actor may see.
function visibleTo(manager: EntityManager, actor: Actor): SelectQueryBuilder<ApplicationOrmEntity> {
  const query = manager.createQueryBuilder(ApplicationOrmEntity, 'application');
  const scope = readScopeFor(actor);
  switch (scope.kind) {
    case 'all':
      return query;
    case 'createdBy':
      return query.where('application.createdBy = :userId', { userId: scope.userId });
    case 'submittedOnly':
      return query.where("application.status <> 'DRAFT'");
  }
}

@QueryHandler(GetApplicationQuery)
export class GetApplicationHandler implements IQueryHandler<GetApplicationQuery> {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  // Not visible and not existing look the same: 404.
  async execute({ actor, id }: GetApplicationQuery): Promise<ApplicationView> {
    const row = await visibleTo(this.uow.manager, actor)
      .andWhere('application.id = :id', { id })
      .getOne();
    if (!row) throw new ApplicationNotFound();
    return toView(row);
  }
}

@QueryHandler(ListApplicationsQuery)
export class ListApplicationsHandler implements IQueryHandler<ListApplicationsQuery> {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  async execute({ actor, filter }: ListApplicationsQuery): Promise<Page<ApplicationView>> {
    const limit = Math.min(Math.max(filter.limit, 1), MAX_PAGE_SIZE);
    const page = Math.max(filter.page, 1);
    const query = visibleTo(this.uow.manager, actor);
    if (filter.status) query.andWhere('application.status = :status', { status: filter.status });

    // Newest first; id breaks ties so pages never overlap or skip rows.
    const [rows, total] = await query
      .orderBy('application.createdAt', 'DESC')
      .addOrderBy('application.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();
    return { items: rows.map(toView), total, page, limit };
  }
}

function toView(row: ApplicationOrmEntity): ApplicationView {
  return {
    id: row.id,
    businessName: row.businessName,
    legalBusinessName: row.legalBusinessName,
    businessType: row.businessType,
    ownerContact: { fullName: row.ownerFullName, email: row.ownerEmail, phone: row.ownerPhone },
    processingInfo: {
      monthlyVolumeCents: row.monthlyVolumeCents,
      averageTicketCents: row.averageTicketCents,
      mcc: row.mcc,
    },
    status: row.status,
    riskStatus: row.riskStatus,
    createdBy: row.createdBy,
    assignedReviewerId: row.assignedReviewerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
