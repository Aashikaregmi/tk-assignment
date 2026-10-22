import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMerchantApplications1792668804342 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // CHECKs repeat the domain rules as a backstop. Values are inlined: migrations are frozen snapshots.
    await queryRunner.query(`
      CREATE TABLE merchant_applications (
        id uuid PRIMARY KEY,
        created_by uuid NOT NULL REFERENCES users (id),
        business_name text NOT NULL,
        legal_business_name text NOT NULL,
        business_type text NOT NULL,
        owner_full_name text NOT NULL,
        owner_email text NOT NULL,
        owner_phone text NOT NULL,
        monthly_volume_cents bigint NOT NULL,
        average_ticket_cents bigint NOT NULL,
        mcc text NOT NULL,
        status text NOT NULL,
        risk_status text NOT NULL,
        assigned_reviewer_id uuid REFERENCES users (id),
        submission_no integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT merchant_applications_business_name_check
          CHECK (length(business_name) BETWEEN 1 AND 200),
        CONSTRAINT merchant_applications_legal_business_name_check
          CHECK (length(legal_business_name) BETWEEN 1 AND 200),
        CONSTRAINT merchant_applications_business_type_check
          CHECK (business_type IN ('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LLC', 'CORPORATION', 'NON_PROFIT')),
        CONSTRAINT merchant_applications_cents_check
          CHECK (average_ticket_cents > 0 AND average_ticket_cents <= monthly_volume_cents),
        CONSTRAINT merchant_applications_mcc_check CHECK (mcc ~ '^[0-9]{4}$'),
        CONSTRAINT merchant_applications_status_check
          CHECK (status IN ('DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED')),
        CONSTRAINT merchant_applications_risk_status_check
          CHECK (risk_status IN ('NOT_STARTED', 'PENDING', 'LOW', 'MEDIUM', 'HIGH', 'FAILED')),
        -- A draft has never been submitted; anything else has, at least once.
        CONSTRAINT merchant_applications_draft_check
          CHECK ((status = 'DRAFT') = (submission_no = 0 AND risk_status = 'NOT_STARTED'))
      )
    `);
    // Lists: by status (ADMIN/REVIEWER filters), by creator (SALES), by reviewer (assignment queue).
    await queryRunner.query(
      'CREATE INDEX merchant_applications_status_created_at_idx ON merchant_applications (status, created_at)',
    );
    await queryRunner.query(
      'CREATE INDEX merchant_applications_created_by_created_at_idx ON merchant_applications (created_by, created_at)',
    );
    await queryRunner.query(
      'CREATE INDEX merchant_applications_assigned_reviewer_id_idx ON merchant_applications (assigned_reviewer_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE merchant_applications');
  }
}
