import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ApplicationsController } from './api/applications.controller';
import { ApplicationRepository } from './application/application-repository';
import { CreateApplicationHandler } from './application/create-application';
import { SubmitApplicationHandler } from './application/submit-application';
import { UpdateApplicationHandler } from './application/update-application';
import {
  GetApplicationHandler,
  ListApplicationsHandler,
} from './infrastructure/application-query-handlers';
import { TypeOrmApplicationRepository } from './infrastructure/typeorm-application.repository';

@Module({
  imports: [CqrsModule],
  controllers: [ApplicationsController],
  providers: [
    CreateApplicationHandler,
    UpdateApplicationHandler,
    SubmitApplicationHandler,
    GetApplicationHandler,
    ListApplicationsHandler,
    { provide: ApplicationRepository, useClass: TypeOrmApplicationRepository },
  ],
})
export class ApplicationsModule {}
