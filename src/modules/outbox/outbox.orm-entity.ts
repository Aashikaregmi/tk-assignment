import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// synchronize: false — the migration owns the partial index.
@Entity({ name: 'outbox', synchronize: false })
export class OutboxOrmEntity {
  // Also the queue's job id, so publishing a row twice can't create two jobs.
  @PrimaryColumn('uuid')
  id!: string;

  @Column('text')
  queue!: string;

  @Column('text')
  type!: string;

  @Column('jsonb')
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  publishedAt!: Date | null;
}
