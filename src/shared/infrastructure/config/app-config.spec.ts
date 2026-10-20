import { loadConfig } from './app-config';

describe('loadConfig', () => {
  it('applies defaults for unset variables', () => {
    expect(loadConfig({}).PORT).toBe(3000);
  });

  it('converts numeric strings', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('keeps only declared variables', () => {
    expect(loadConfig({ PORT: '8080', PATH: '/usr/bin' })).toEqual({ PORT: 8080 });
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
