import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ProblemDetailsFilter } from '@shared/api/problem-details.filter';
import { AppConfigModule } from '@shared/infrastructure/config/app-config.module';
import { DatabaseModule } from '@shared/infrastructure/database/database.module';
import { LoggingModule } from '@shared/infrastructure/logging/logging.module';
import { IdentityModule } from '@modules/identity';

@Module({
  imports: [AppConfigModule, LoggingModule, DatabaseModule, IdentityModule],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
