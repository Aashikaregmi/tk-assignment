import { loadConfig } from './app-config';

const db = { DB_NAME: 'vizy', DB_USER: 'app', DB_PASSWORD: 'not-a-real-password' };

describe('loadConfig', () => {
  it('applies defaults for unset optional variables', () => {
    expect(loadConfig(db)).toEqual({
      PORT: 3000,
      LOG_LEVEL: 'info',
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      ...db,
    });
  });

  it('converts numeric strings', () => {
    expect(loadConfig({ ...db, PORT: '8080', DB_PORT: '6543' })).toMatchObject({
      PORT: 8080,
      DB_PORT: 6543,
    });
  });

  it('drops undeclared variables', () => {
    expect(loadConfig({ ...db, PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });

  it.each(['DB_NAME', 'DB_USER', 'DB_PASSWORD'])('requires %s', (key) => {
    expect(() => loadConfig({ ...db, [key]: undefined })).toThrow(new RegExp(key));
    expect(() => loadConfig({ ...db, [key]: '' })).toThrow(new RegExp(key));
  });

  it('rejects unknown log levels', () => {
    expect(() => loadConfig({ ...db, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it.each(['abc', '', '0', '70000'])('rejects PORT=%p', (port) => {
    expect(() => loadConfig({ ...db, PORT: port })).toThrow(
      /Invalid environment configuration:[\s\S]*PORT/,
    );
  });

  it('does not echo the rejected value', () => {
    const load = () => loadConfig({ ...db, PORT: 's3cret-value' });
    expect(load).toThrow(/PORT/);
    expect(load).not.toThrow(/s3cret-value/);
  });
});
