import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
  ValueTransformer,
} from 'typeorm';
import type { ApplicationStatus, RiskStatus } from '../domain/application-status';
import type { BusinessType } from '../domain/merchant-application';

// pg returns bigint as a string; the domain keeps cents within Number.MAX_SAFE_INTEGER.
const cents: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string) => Number(value),
};

// synchronize: false — the schema is owned by the hand-written migration. Without it,
// migration:generate would try to drop the FKs to users, which this module can't declare.
@Entity({ name: 'merchant_applications', synchronize: false })
export class ApplicationOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'created_by' })
  createdBy!: string;

  @Column('text', { name: 'business_name' })
  businessName!: string;

  @Column('text', { name: 'legal_business_name' })
  legalBusinessName!: string;

  @Column('text', { name: 'business_type' })
  businessType!: BusinessType;

  @Column('text', { name: 'owner_full_name' })
  ownerFullName!: string;

  @Column('text', { name: 'owner_email' })
  ownerEmail!: string;

  @Column('text', { name: 'owner_phone' })
  ownerPhone!: string;

  @Column('bigint', { name: 'monthly_volume_cents', transformer: cents })
  monthlyVolumeCents!: number;

  @Column('bigint', { name: 'average_ticket_cents', transformer: cents })
  averageTicketCents!: number;

  @Column('text')
  mcc!: string;

  @Column('text')
  status!: ApplicationStatus;

  @Column('text', { name: 'risk_status' })
  riskStatus!: RiskStatus;

  @Column('uuid', { name: 'assigned_reviewer_id', nullable: true })
  assignedReviewerId!: string | null;

  @Column('integer', { name: 'submission_no' })
  submissionNo!: number;

  @Column('text', { name: 'decision_reason', nullable: true })
  decisionReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
