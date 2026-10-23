import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { IdentityModule } from '@modules/identity';
import { ApplicationsController } from './api/applications.controller';
import { ApplicationRepository } from './application/application-repository';
import { AssignReviewerHandler } from './application/assign-reviewer';
import { CreateApplicationHandler } from './application/create-application';
import { RecordDecisionHandler } from './application/record-decision';
import { ReviewerDirectory } from './application/reviewer-directory';
import { SubmitApplicationHandler } from './application/submit-application';
import { UpdateApplicationHandler } from './application/update-application';
import {
  GetApplicationHandler,
  ListApplicationsHandler,
} from './infrastructure/application-query-handlers';
import { IdentityReviewerDirectory } from './infrastructure/identity-reviewer-directory';
import { TypeOrmApplicationRepository } from './infrastructure/typeorm-application.repository';

@Module({
  imports: [CqrsModule, IdentityModule],
  controllers: [ApplicationsController],
  providers: [
    CreateApplicationHandler,
    UpdateApplicationHandler,
    SubmitApplicationHandler,
    AssignReviewerHandler,
    RecordDecisionHandler,
    GetApplicationHandler,
    ListApplicationsHandler,
    { provide: ApplicationRepository, useClass: TypeOrmApplicationRepository },
    { provide: ReviewerDirectory, useClass: IdentityReviewerDirectory },
  ],
})
export class ApplicationsModule {}
