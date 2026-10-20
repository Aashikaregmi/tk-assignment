import { DataSource } from 'typeorm';
import { loadConfig } from '../src/shared/infrastructure/config/app-config';
import { asOwner, dataSourceOptions } from '../src/shared/infrastructure/database/data-source';
import { testEnv } from './test-env';

export default async function migrateTestDatabase(): Promise<void> {
  const owner = new DataSource(dataSourceOptions(loadConfig(asOwner(testEnv()))));
  await owner.initialize();
  try {
    await owner.runMigrations();
  } finally {
    await owner.destroy();
  }
}
