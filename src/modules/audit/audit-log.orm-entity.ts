import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// synchronize: false — the migration also owns the append-only trigger and the REVOKE.
@Entity({ name: 'audit_log', synchronize: false })
export class AuditLogOrmEntity {
  // bigint: pg returns it as a string. Ascending ids are insertion order.
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id!: string;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column('uuid', { name: 'actor_id', nullable: true })
  actorId!: string | null;

  @Column('text')
  action!: string;

  @Column('text', { name: 'entity_type' })
  entityType!: string;

  @Column('uuid', { name: 'entity_id' })
  entityId!: string;

  @Column('jsonb')
  metadata!: Record<string, unknown>;
}
