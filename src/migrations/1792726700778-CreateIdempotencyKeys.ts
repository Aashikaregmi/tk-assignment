import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdempotencyKeys1792726700778 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Keyed per user, so one user's key never replays another user's response.
    // response_body is null only inside the request's own transaction; committed rows have it.
    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        user_id uuid NOT NULL REFERENCES users (id),
        key text NOT NULL,
        request_hash text NOT NULL,
        response_body jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, key),
        CONSTRAINT idempotency_keys_key_check CHECK (length(key) BETWEEN 1 AND 255),
        CONSTRAINT idempotency_keys_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$')
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE idempotency_keys');
  }
}
