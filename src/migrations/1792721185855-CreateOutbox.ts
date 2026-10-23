import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutbox1792721185855 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Messages for other processes, written in the same transaction as the change that causes them.
    await queryRunner.query(`
      CREATE TABLE outbox (
        id uuid PRIMARY KEY,
        queue text NOT NULL,
        type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz
      )
    `);
    // The relay's poll: unpublished rows, oldest first. Published rows drop out of the index.
    await queryRunner.query(
      'CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox');
  }
}
