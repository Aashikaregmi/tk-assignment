import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { RiskReview, RiskReviewRepository } from '../application/risk-review-repository';
import { RiskReviewOrmEntity } from './risk-review.orm-entity';

@Injectable()
export class TypeOrmRiskReviewRepository implements RiskReviewRepository {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  // insert, not save: a second review for the same submission must fail, never overwrite.
  async add(review: RiskReview): Promise<void> {
    await this.uow.manager.insert(RiskReviewOrmEntity, { id: randomUUID(), ...review });
  }
}
