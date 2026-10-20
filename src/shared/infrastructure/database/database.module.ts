import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UnitOfWork } from '../../application/unit-of-work';
import { AppConfig } from '../config/app-config';
import { dataSourceOptions } from './data-source';
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
  ],
  exports: [DataSource, TypeOrmUnitOfWork, UnitOfWork],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    await this.dataSource.destroy();
  }
}
