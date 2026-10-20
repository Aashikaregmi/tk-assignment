import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1792509144346 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Roles are inlined, not imported: a migration is a frozen snapshot of the schema.
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'REVIEWER', 'SALES')),
        -- Only argon2id hashes, so a plaintext password can never be stored by mistake.
        CONSTRAINT users_password_hash_check CHECK (password_hash LIKE '$argon2id$%')
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX users_email_key ON users (lower(email))');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE users');
  }
}
