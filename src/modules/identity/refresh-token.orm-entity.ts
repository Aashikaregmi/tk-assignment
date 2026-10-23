import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// synchronize: false — the migration owns the foreign keys and CHECKs.
@Entity({ name: 'refresh_tokens', synchronize: false })
export class RefreshTokenOrmEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'user_id' })
  userId!: string;

  @Column('uuid', { name: 'family_id' })
  familyId!: string;

  // SHA-256 of the token; the token itself is only ever in the client's hands.
  @Column('text', { name: 'token_hash' })
  tokenHash!: string;

  @Column('timestamptz', { name: 'expires_at' })
  expiresAt!: Date;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @Column('uuid', { name: 'replaced_by', nullable: true })
  replacedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
