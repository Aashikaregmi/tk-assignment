import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min, validateSync } from 'class-validator';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export class AppConfig {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: (typeof LOG_LEVELS)[number] = 'info';
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const config = plainToInstance(AppConfig, env);
  // whitelist strips undeclared variables (PATH, HOME, ...).
  const errors = validateSync(config, { whitelist: true });
  if (errors.length > 0) {
    // Messages name the variable, never its value (it may be a secret).
    const problems = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  }
  return config;
}
