import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { ProblemDetailsFilter } from '@shared/api/problem-details.filter';
import { AppConfigModule } from '@shared/infrastructure/config/app-config.module';
import { DatabaseModule } from '@shared/infrastructure/database/database.module';
import { QueueModule } from '@shared/infrastructure/queue/queue.module';
import { LoggingModule } from '@shared/infrastructure/logging/logging.module';
import { ApplicationsModule } from '@modules/applications';
import { AuditModule } from '@modules/audit';
import { OutboxModule } from '@modules/outbox';
import { IdentityModule } from '@modules/identity';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    QueueModule,
    CqrsModule.forRoot(),
    IdentityModule,
    ApplicationsModule,
    AuditModule,
    OutboxModule,
  ],
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
