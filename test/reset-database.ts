import { DataSource } from 'typeorm';
import { DatabaseConfig, loadConfig } from '../src/shared/infrastructure/config/app-config';
import { asOwner, dataSourceOptions } from '../src/shared/infrastructure/database/data-source';
import { testEnv } from './test-env';

// Empties every table except migration history. As the owner: the app role can't TRUNCATE.
export async function resetDatabase(): Promise<void> {
  const options = dataSourceOptions(loadConfig(DatabaseConfig, asOwner(testEnv())));
  const owner = await new DataSource({ ...options, entities: [] }).initialize();
  try {
    const tables = await owner.query<{ tablename: string }[]>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'",
    );
    if (tables.length > 0) {
      await owner.query(
        `TRUNCATE ${tables.map(({ tablename }) => `"${tablename}"`).join(', ')} CASCADE`,
      );
    }
  } finally {
    await owner.destroy();
  }
}
