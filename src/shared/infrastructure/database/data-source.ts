import { DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/app-config';

export function dataSourceOptions(config: DatabaseConfig): DataSourceOptions {
  return {
    type: 'postgres',
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    username: config.DB_USER,
    password: config.DB_PASSWORD,
    // Schema changes only through reviewed migrations.
    synchronize: false,
    // .ts under ts-jest, .js in dist.
    entities: [`${__dirname}/../../../**/*.orm-entity.{ts,js}`],
    migrations: [`${__dirname}/../../../migrations/*.{ts,js}`],
  };
}

// Migrations run as the schema owner; the app role can't run DDL.
export function asOwner(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...env, DB_USER: env.DB_OWNER_USER, DB_PASSWORD: env.DB_OWNER_PASSWORD };
}
