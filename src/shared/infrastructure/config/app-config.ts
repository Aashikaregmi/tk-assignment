import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

// Enough for the migration CLI and DB tests, which must not need app secrets.
export class DatabaseConfig {
  @IsString()
  @IsNotEmpty()
  DB_HOST: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;
}

export class AppConfig extends DatabaseConfig {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: (typeof LOG_LEVELS)[number] = 'info';

  // HS256 key: at least 256 bits.
  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  // Logical database: tests use their own, so a dev worker never takes their jobs.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(15)
  REDIS_DB: number = 0;

  // Simulated risk provider: fail the first N calls for each submission (retry demos and tests).
  @Type(() => Number)
  @IsInt()
  @Min(0)
  RISK_PROVIDER_FAILURES: number = 0;
}

export function loadConfig<T extends object>(
  configClass: new () => T,
  env: Record<string, string | undefined>,
): T {
  const config = plainToInstance(configClass, env);
  // whitelist strips undeclared variables (PATH, HOME, ...).
  const errors = validateSync(config, { whitelist: true });
  if (errors.length > 0) {
    // Messages name the variable, never its value.
    const problems = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  }
  return config;
}
