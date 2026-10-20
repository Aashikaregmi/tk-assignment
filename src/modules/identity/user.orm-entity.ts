import type { Role } from '@shared/domain/role';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Mirrors CreateUsers1792509144346; constraints are declared so migration:generate reports no drift.
@Entity('users')
@Check('users_role_check', `role IN ('ADMIN', 'REVIEWER', 'SALES')`)
@Check('users_password_hash_check', `password_hash LIKE '$argon2id$%'`)
export class UserOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text')
  email!: string;

  @Column('text', { name: 'password_hash' })
  passwordHash!: string;

  @Column('text')
  role!: Role;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
