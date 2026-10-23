import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRiskReviews1792723999015 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // One outcome per submission. The unique key is the backstop if two workers ever both
    // got past the row lock: the second insert fails and its transaction rolls back.
    await queryRunner.query(`
      CREATE TABLE risk_reviews (
        id uuid PRIMARY KEY,
        application_id uuid NOT NULL REFERENCES merchant_applications (id),
        submission_no integer NOT NULL,
        result text NOT NULL,
        score integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT risk_reviews_application_id_submission_no_key
          UNIQUE (application_id, submission_no),
        CONSTRAINT risk_reviews_result_check CHECK (result IN ('LOW', 'MEDIUM', 'HIGH', 'FAILED')),
        -- A provider answer has a score; a review that failed has none.
        CONSTRAINT risk_reviews_score_check CHECK (
          CASE WHEN result = 'FAILED' THEN score IS NULL
          ELSE score IS NOT NULL AND score BETWEEN 0 AND 100 END
        )
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE risk_reviews');
  }
}
