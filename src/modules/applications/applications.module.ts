import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuditModule } from '@modules/audit';
import { IdentityModule } from '@modules/identity';
import { OutboxModule } from '@modules/outbox';
import { ApplicationsController } from './api/applications.controller';
import { ApplicationRepository } from './application/application-repository';
import { AssignReviewerHandler } from './application/assign-reviewer';
import { CreateApplicationHandler } from './application/create-application';
import { DomainEventPublisher } from './application/domain-event-publisher';
import { FailRiskReviewHandler } from './application/fail-risk-review';
import { ProcessRiskReviewHandler } from './application/process-risk-review';
import { RecordDecisionHandler } from './application/record-decision';
import { ReviewerDirectory } from './application/reviewer-directory';
import { RiskProvider } from './application/risk-provider';
import { RiskReviewRepository } from './application/risk-review-repository';
import { SubmitApplicationHandler } from './application/submit-application';
import { UpdateApplicationHandler } from './application/update-application';
import {
  GetApplicationHandler,
  ListApplicationsHandler,
} from './infrastructure/application-query-handlers';
import { IdentityReviewerDirectory } from './infrastructure/identity-reviewer-directory';
import { RiskReviewWorker } from './infrastructure/risk-review.worker';
import { SimulatedRiskProvider } from './infrastructure/simulated-risk-provider';
import { TransactionalEventPublisher } from './infrastructure/transactional-event-publisher';
import { TypeOrmApplicationRepository } from './infrastructure/typeorm-application.repository';
import { TypeOrmRiskReviewRepository } from './infrastructure/typeorm-risk-review.repository';

@Module({
  imports: [CqrsModule, IdentityModule, AuditModule, OutboxModule],
  controllers: [ApplicationsController],
  providers: [
    CreateApplicationHandler,
    UpdateApplicationHandler,
    SubmitApplicationHandler,
    AssignReviewerHandler,
    RecordDecisionHandler,
    ProcessRiskReviewHandler,
    FailRiskReviewHandler,
    RiskReviewWorker,
    GetApplicationHandler,
    ListApplicationsHandler,
    { provide: ApplicationRepository, useClass: TypeOrmApplicationRepository },
    { provide: ReviewerDirectory, useClass: IdentityReviewerDirectory },
    { provide: DomainEventPublisher, useClass: TransactionalEventPublisher },
    { provide: RiskProvider, useClass: SimulatedRiskProvider },
    { provide: RiskReviewRepository, useClass: TypeOrmRiskReviewRepository },
  ],
})
export class ApplicationsModule {}
