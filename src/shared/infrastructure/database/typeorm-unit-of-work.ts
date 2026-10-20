import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UnitOfWork } from '../../application/unit-of-work';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  // Per async call chain, so concurrent requests never share a transaction.
  private readonly transaction = new AsyncLocalStorage<EntityManager>();

  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.transaction.getStore()) return work();
    return this.dataSource.transaction((manager) => this.transaction.run(manager, work));
  }

  // For repositories: the current transaction inside run(), otherwise the pool (plain reads).
  get manager(): EntityManager {
    return this.transaction.getStore() ?? this.dataSource.manager;
  }
}
