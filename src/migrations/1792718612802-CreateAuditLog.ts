import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLog1792718612802 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // No foreign keys: the trail must outlive what it records. actor_id is null for the system.
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        actor_id uuid,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id uuid NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'
      )
    `);
    await queryRunner.query('CREATE INDEX audit_log_entity_id_idx ON audit_log (entity_id, id)');

    // Append-only, twice over: the trigger stops even the owner; the REVOKE stops the app role first.
    await queryRunner.query(`
      CREATE FUNCTION audit_log_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change()
    `);
    // The app role's name is configurable; it got UPDATE and DELETE from the default privileges.
    await queryRunner.query(`
      DO $$
      DECLARE role_name text;
      BEGIN
        FOR role_name IN
          SELECT DISTINCT grantee FROM information_schema.role_table_grants
          WHERE table_name = 'audit_log' AND privilege_type IN ('UPDATE', 'DELETE')
            AND grantee <> current_user
        LOOP
          EXECUTE format('REVOKE UPDATE, DELETE ON audit_log FROM %I', role_name);
        END LOOP;
      END
      $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE audit_log');
    await queryRunner.query('DROP FUNCTION audit_log_reject_change()');
  }
}
