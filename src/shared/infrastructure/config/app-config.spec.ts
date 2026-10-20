import { loadConfig } from './app-config';

describe('loadConfig', () => {
  it('applies defaults for unset variables', () => {
    expect(loadConfig({})).toEqual({ PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('converts numeric strings', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('drops undeclared variables', () => {
    expect(loadConfig({ PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });

  it('rejects unknown log levels', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it.each(['abc', '', '0', '70000'])('rejects PORT=%p', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(
      /Invalid environment configuration:[\s\S]*PORT/,
    );
  });

  it('does not echo the rejected value', () => {
    const load = () => loadConfig({ PORT: 's3cret-value' });
    expect(load).toThrow(/PORT/);
    expect(load).not.toThrow(/s3cret-value/);
  });
});
