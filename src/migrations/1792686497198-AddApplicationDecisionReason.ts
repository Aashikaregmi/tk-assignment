import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplicationDecisionReason1792686497198 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Backstop for decide(): undecided rows carry no reason; a decision has its reviewer,
    // an approval a risk result, a rejection or info request a reason.
    await queryRunner.query(`
      ALTER TABLE merchant_applications
        ADD COLUMN decision_reason text,
        ADD CONSTRAINT merchant_applications_decision_reason_check
          CHECK (length(decision_reason) BETWEEN 1 AND 1000),
        ADD CONSTRAINT merchant_applications_decision_check CHECK (
          CASE
            WHEN status IN ('DRAFT', 'SUBMITTED') THEN decision_reason IS NULL
            WHEN status = 'APPROVED' THEN assigned_reviewer_id IS NOT NULL
              AND risk_status IN ('LOW', 'MEDIUM', 'HIGH')
            WHEN status IN ('REJECTED', 'INFO_REQUESTED') THEN assigned_reviewer_id IS NOT NULL
              AND decision_reason IS NOT NULL
          END
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE merchant_applications
        DROP CONSTRAINT merchant_applications_decision_check,
        DROP CONSTRAINT merchant_applications_decision_reason_check,
        DROP COLUMN decision_reason
    `);
  }
}
