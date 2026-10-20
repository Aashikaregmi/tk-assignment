import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfig } from '../config/app-config';
import { dataSourceOptions } from './data-source';

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new DataSource(dataSourceOptions(config)).initialize(),
    },
  ],
  exports: [DataSource],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    await this.dataSource.destroy();
  }
}
