import { Query } from '@nestjs/cqrs';
import type { Actor } from '@shared/domain/role';
import type { ApplicationStatus, RiskStatus } from '../domain/application-status';
import type { BusinessType } from '../domain/merchant-application';
import type { OwnerContactProps } from '../domain/owner-contact';
import type { ProcessingInfoProps } from '../domain/processing-info';

export const MAX_PAGE_SIZE = 100;

export interface ApplicationView {
  id: string;
  businessName: string;
  legalBusinessName: string;
  businessType: BusinessType;
  ownerContact: OwnerContactProps;
  processingInfo: ProcessingInfoProps;
  status: ApplicationStatus;
  riskStatus: RiskStatus;
  createdBy: string;
  assignedReviewerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// Handlers are in infrastructure: reads go straight to SQL, scoped by the access policy.
export class GetApplicationQuery extends Query<ApplicationView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListApplicationsQuery extends Query<Page<ApplicationView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: { status?: ApplicationStatus; page: number; limit: number },
  ) {
    super();
  }
}
