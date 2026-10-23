import { fingerprint } from './idempotency';

const body = { decision: 'REJECT', reason: 'MCC not supported', tags: [{ b: 1, a: 2 }] };
const base = fingerprint('POST', '/applications/a1/decision', body);

describe('fingerprint', () => {
  it('is a SHA-256 hex digest', () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores property order, at any depth', () => {
    const reordered = { tags: [{ a: 2, b: 1 }], reason: 'MCC not supported', decision: 'REJECT' };
    expect(fingerprint('POST', '/applications/a1/decision', reordered)).toBe(base);
  });

  it.each<[string, string, string, unknown]>([
    ['another method', 'PUT', '/applications/a1/decision', body],
    ['another path (another application)', 'POST', '/applications/a2/decision', body],
    ['another value', 'POST', '/applications/a1/decision', { ...body, decision: 'APPROVE' }],
    ['an extra field', 'POST', '/applications/a1/decision', { ...body, note: 'x' }],
    ['array order', 'POST', '/applications/a1/decision', { ...body, tags: [{}, { b: 1, a: 2 }] }],
    ['no body', 'POST', '/applications/a1/decision', undefined],
  ])('changes with %s', (_case, method, path, other) => {
    expect(fingerprint(method, path, other)).not.toBe(base);
  });
});
