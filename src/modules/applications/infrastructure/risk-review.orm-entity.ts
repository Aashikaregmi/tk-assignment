import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { RiskReview } from '../application/risk-review-repository';

// synchronize: false — the migration owns the foreign key and CHECKs.
@Entity({ name: 'risk_reviews', synchronize: false })
export class RiskReviewOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'application_id' })
  applicationId!: string;

  @Column('integer', { name: 'submission_no' })
  submissionNo!: number;

  @Column('text')
  result!: RiskReview['result'];

  @Column('integer', { nullable: true })
  score!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
