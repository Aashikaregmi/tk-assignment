import { AppConfig, DatabaseConfig, loadConfig } from './app-config';

const db = { DB_NAME: 'vizy', DB_USER: 'app', DB_PASSWORD: 'not-a-real-password' };
const app = { ...db, JWT_SECRET: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('applies defaults for unset optional variables', () => {
    expect(loadConfig(AppConfig, app)).toEqual({
      PORT: 3000,
      LOG_LEVEL: 'info',
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_DB: 0,
      RISK_PROVIDER_FAILURES: 0,
      ...app,
    });
  });

  it('loads database settings alone, without app secrets', () => {
    const config = loadConfig(DatabaseConfig, app);
    expect(config).toEqual({ DB_HOST: 'localhost', DB_PORT: 5432, ...db });
    expect(config).not.toHaveProperty('JWT_SECRET');
  });

  it('converts numeric strings', () => {
    expect(
      loadConfig(AppConfig, { ...app, PORT: '8080', DB_PORT: '6543', REDIS_PORT: '6380' }),
    ).toMatchObject({ PORT: 8080, DB_PORT: 6543, REDIS_PORT: 6380 });
  });

  it('drops undeclared variables', () => {
    expect(loadConfig(AppConfig, { ...app, PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });

  it.each(['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'])('requires %s', (key) => {
    expect(() => loadConfig(AppConfig, { ...app, [key]: undefined })).toThrow(new RegExp(key));
    expect(() => loadConfig(AppConfig, { ...app, [key]: '' })).toThrow(new RegExp(key));
  });

  it('rejects a JWT_SECRET shorter than 256 bits', () => {
    expect(() => loadConfig(AppConfig, { ...app, JWT_SECRET: 'x'.repeat(31) })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects unknown log levels', () => {
    expect(() => loadConfig(AppConfig, { ...app, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it.each(['abc', '', '0', '70000'])('rejects PORT=%p', (port) => {
    expect(() => loadConfig(AppConfig, { ...app, PORT: port })).toThrow(
      /Invalid environment configuration:[\s\S]*PORT/,
    );
  });

  it('does not echo the rejected value', () => {
    const load = () => loadConfig(AppConfig, { ...app, JWT_SECRET: 's3cret-value' });
    expect(load).toThrow(/JWT_SECRET/);
    expect(load).not.toThrow(/s3cret-value/);
  });
});
