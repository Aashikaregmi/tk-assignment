import { IsString, MinLength } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import type { Role } from '@shared/domain/role';
import { DatabaseConfig, loadConfig } from '@shared/infrastructure/config/app-config';
import { dataSourceOptions } from '@shared/infrastructure/database/data-source';
import { PasswordHasher } from './password-hasher';

// Reserved example.com domain (RFC 2606): never real people.
export const SEED_USERS: ReadonlyArray<{ email: string; role: Role }> = [
  { email: 'admin@example.com', role: 'ADMIN' },
  { email: 'sales.one@example.com', role: 'SALES' },
  { email: 'sales.two@example.com', role: 'SALES' },
  { email: 'reviewer.one@example.com', role: 'REVIEWER' },
  { email: 'reviewer.two@example.com', role: 'REVIEWER' },
];

class SeedConfig extends DatabaseConfig {
  @IsString()
  @MinLength(12)
  SEED_USER_PASSWORD!: string;
}

// Upsert, so re-running resets roles and passwords instead of failing.
export async function seedUsers(manager: EntityManager, password: string): Promise<void> {
  const hasher = new PasswordHasher();
  for (const { email, role } of SEED_USERS) {
    await manager.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, updated_at = now()`,
      [email, await hasher.hash(password), role],
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig(SeedConfig, process.env);
  const dataSource = await new DataSource(dataSourceOptions(config)).initialize();
  try {
    await dataSource.transaction((manager) => seedUsers(manager, config.SEED_USER_PASSWORD));
  } finally {
    await dataSource.destroy();
  }
  console.log(`Seeded: ${SEED_USERS.map(({ email, role }) => `${email} (${role})`).join(', ')}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
