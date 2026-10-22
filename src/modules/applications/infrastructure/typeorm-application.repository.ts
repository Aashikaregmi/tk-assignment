import { Injectable } from '@nestjs/common';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { ApplicationRepository } from '../application/application-repository';
import type { MerchantApplication } from '../domain/merchant-application';
import { toDomain, toRow } from './application.mapper';
import { ApplicationOrmEntity } from './application.orm-entity';

@Injectable()
export class TypeOrmApplicationRepository implements ApplicationRepository {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  // SELECT … FOR UPDATE. TypeORM throws if there's no transaction, so a lock can't silently vanish.
  async findByIdForUpdate(id: string): Promise<MerchantApplication | null> {
    const row = await this.uow.manager.findOne(ApplicationOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return row ? toDomain(row) : null;
  }

  async save(application: MerchantApplication): Promise<void> {
    await this.uow.manager.save(ApplicationOrmEntity, toRow(application));
  }
}
