import { Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './app-config';

@Global()
@Module({
  // useFactory reads process.env at bootstrap, so tests can set variables first.
  providers: [{ provide: AppConfig, useFactory: () => loadConfig(process.env) }],
  exports: [AppConfig],
})
export class AppConfigModule {}
