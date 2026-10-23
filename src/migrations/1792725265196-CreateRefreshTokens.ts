import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokens1792725265196 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // A family is one login's chain of rotated tokens; reuse of a rotated token revokes the family.
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users (id),
        family_id uuid NOT NULL,
        token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        replaced_by uuid REFERENCES refresh_tokens (id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash),
        -- SHA-256 hex digests only, so a raw token can never be stored by mistake.
        CONSTRAINT refresh_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        -- Rotation revokes a token and points to its successor; logout revokes without one.
        CONSTRAINT refresh_tokens_replaced_by_check CHECK (replaced_by IS NULL OR revoked_at IS NOT NULL),
        CONSTRAINT refresh_tokens_expires_at_check CHECK (expires_at > created_at)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE refresh_tokens');
  }
}
