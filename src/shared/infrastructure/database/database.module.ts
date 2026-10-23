import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IdempotencyStore } from '../../application/idempotency-store';
import { UnitOfWork } from '../../application/unit-of-work';
import { AppConfig } from '../config/app-config';
import { dataSourceOptions } from './data-source';
import { PostgresIdempotencyStore } from './postgres-idempotency-store';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new DataSource(dataSourceOptions(config)).initialize(),
    },
    TypeOrmUnitOfWork,
    { provide: UnitOfWork, useExisting: TypeOrmUnitOfWork },
    { provide: IdempotencyStore, useClass: PostgresIdempotencyStore },
  ],
  exports: [DataSource, TypeOrmUnitOfWork, UnitOfWork, IdempotencyStore],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    await this.dataSource.destroy();
  }
}
