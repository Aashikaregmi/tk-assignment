import { randomUUID } from 'node:crypto';
import { RiskReview } from '@modules/applications/application/risk-review-repository';
import { MerchantApplication } from '@modules/applications/domain/merchant-application';
import { OwnerContact } from '@modules/applications/domain/owner-contact';
import { ProcessingInfo } from '@modules/applications/domain/processing-info';
import { TypeOrmApplicationRepository } from '@modules/applications/infrastructure/typeorm-application.repository';
import { TypeOrmRiskReviewRepository } from '@modules/applications/infrastructure/typeorm-risk-review.repository';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { DataSource } from 'typeorm';
import { resetDatabase } from './reset-database';
import { testEnv } from './test-env';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2g';

describe('TypeOrmRiskReviewRepository', () => {
  let db: DataSource;
  let uow: TypeOrmUnitOfWork;
  let reviews: TypeOrmRiskReviewRepository;
  let applicationId: string;

  beforeAll(async () => {
    db = await new DataSource(
      dataSourceOptions(loadConfig(DatabaseConfig, testEnv())),
    ).initialize();
    uow = new TypeOrmUnitOfWork(db);
    reviews = new TypeOrmRiskReviewRepository(uow);
  });

  afterAll(() => db.destroy());

  beforeEach(async () => {
    await resetDatabase();
    const [user] = await db.query<{ id: string }[]>(
      "INSERT INTO users (email, password_hash, role) VALUES ('sales.one@example.com', $1, 'SALES') RETURNING id",
      [FAKE_HASH],
    );
    // Fake data only.
    const application = MerchantApplication.create(randomUUID(), user!.id, {
      businessName: 'Example Coffee',
      legalBusinessName: 'Example Coffee LLC',
      businessType: 'LLC',
      ownerContact: new OwnerContact({
        fullName: 'Jane Example',
        email: 'jane@example.com',
        phone: '+15550100123',
      }),
      processingInfo: new ProcessingInfo({
        monthlyVolumeCents: 2_500_000,
        averageTicketCents: 4_500,
        mcc: '5812',
      }),
    });
    await uow.run(() => new TypeOrmApplicationRepository(uow).save(application));
    applicationId = application.id;
  });

  const add = (review: Partial<RiskReview>) =>
    uow.run(() =>
      reviews.add({ applicationId, submissionNo: 1, result: 'LOW', score: 10, ...review }),
    );
  const stored = () =>
    db.query<{ submission_no: number; result: string; score: number | null }[]>(
      'SELECT submission_no, result, score FROM risk_reviews ORDER BY submission_no',
    );

  it('keeps one review per submission', async () => {
    await add({});
    await add({ submissionNo: 2, result: 'FAILED', score: null });

    await expect(add({ result: 'HIGH', score: 90 })).rejects.toThrow(
      /risk_reviews_application_id_submission_no_key/,
    );
    expect(await stored()).toEqual([
      { submission_no: 1, result: 'LOW', score: 10 },
      { submission_no: 2, result: 'FAILED', score: null },
    ]);
  });

  it.each<[string, Partial<RiskReview>, RegExp]>([
    ['a result without a score', { score: null }, /risk_reviews_score_check/],
    ['a failure with a score', { result: 'FAILED', score: 50 }, /risk_reviews_score_check/],
    ['a score above 100', { score: 101 }, /risk_reviews_score_check/],
    ['an unknown result', { result: 'UNKNOWN' as never }, /risk_reviews_result_check/],
    ['an unknown application', { applicationId: randomUUID() }, /application_id_fkey/],
  ])('rejects %s', async (_case, review, constraint) => {
    await expect(add(review)).rejects.toThrow(constraint);
  });
});
