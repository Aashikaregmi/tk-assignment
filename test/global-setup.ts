import { DataSource } from 'typeorm';
import { DatabaseConfig, loadConfig } from '../src/shared/infrastructure/config/app-config';
import { asOwner, dataSourceOptions } from '../src/shared/infrastructure/database/data-source';
import { testEnv } from './test-env';

export default async function migrateTestDatabase(): Promise<void> {
  // Migrations only. Entities aren't loaded: globalSetup runs outside Jest's moduleNameMapper.
  const options = dataSourceOptions(loadConfig(DatabaseConfig, asOwner(testEnv())));
  const owner = new DataSource({ ...options, entities: [] });
  await owner.initialize();
  try {
    await owner.runMigrations();
  } finally {
    await owner.destroy();
  }
}
