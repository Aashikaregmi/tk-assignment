import { randomBytes } from 'node:crypto';
import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { App } from 'supertest/types';
import { AppConfig, loadConfig } from '../src/shared/infrastructure/config/app-config';
import { AppModule } from '../src/app.module';
import { testEnv } from './test-env';

// The real AppModule (global pipe, filter and guards) against the test database.
export async function createTestApp(
  options: { controllers?: Type[]; throttleLogin?: boolean; env?: Record<string, string> } = {},
): Promise<INestApplication<App>> {
  const config = loadConfig(AppConfig, {
    ...testEnv(),
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
    ...options.env,
  });

  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(AppConfig)
    .useValue(config);
  // Most suites log in more than the 5-per-minute limit allows.
  if (!options.throttleLogin) {
    builder = builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true });
  }

  const app = (await builder.compile()).createNestApplication<INestApplication<App>>({
    logger: false,
  });
  return app.init();
}
