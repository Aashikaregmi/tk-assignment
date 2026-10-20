import { maskDeep, maskEmail, maskPhone, REDACTED, sensitivityOf } from './sensitive-data';

describe('sensitivityOf', () => {
  it.each([
    ['password', 'secret'],
    ['newPassword', 'secret'],
    ['passwordHash', 'secret'],
    ['refresh_token', 'secret'],
    ['accessToken', 'secret'],
    ['Authorization', 'secret'],
    ['Set-Cookie', 'secret'],
    ['x-api-key', 'secret'],
    ['jwtSecret', 'secret'],
    ['bankAccountNumber', 'secret'],
    ['tax_id', 'secret'],
    ['ownerSsn', 'secret'],
    ['cardCvv', 'secret'],
    ['syntaxIdentifier', undefined],
    ['email', 'email'],
    ['ownerEmail', 'email'],
    ['contact_phone', 'phone'],
    ['fullName', 'fullname'],
    ['businessName', undefined],
    ['legalBusinessName', undefined],
    ['status', undefined],
    ['id', undefined],
  ])('%s → %s', (key, expected) => {
    expect(sensitivityOf(key)).toBe(expected);
  });
});

describe('maskEmail', () => {
  it.each([
    ['jane.example@example.com', 'j***@example.com'],
    ['x@example.org', 'x***@example.org'],
    ['not-an-email', 'n***'],
    ['@example.com', '@***'],
    ['', '***'],
  ])('%p → %p', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});

describe('maskPhone', () => {
  it.each([
    ['+1 (555) 010-0123', '***0123'],
    ['5550100199', '***0199'],
    ['0123', '***'],
    ['', '***'],
  ])('%p → %p', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });
});

describe('maskDeep', () => {
  it('redacts secrets and masks personal data at any depth, including arrays', () => {
    const input = {
      headers: { Authorization: 'Bearer abc.def.ghi', 'set-cookie': ['sid=1'] },
      body: { password: 'hunter2', refresh_token: 'rt-123' },
      owner: { fullName: 'Jane Example', email: 'jane@example.com', phone: '555-010-0123' },
      contacts: [{ ownerEmail: 'ops@example.com', apiKey: 'k-1' }],
    };

    expect(maskDeep(input)).toEqual({
      headers: { Authorization: REDACTED, 'set-cookie': REDACTED },
      body: { password: REDACTED, refresh_token: REDACTED },
      owner: { fullName: 'J***', email: 'j***@example.com', phone: '***0123' },
      contacts: [{ ownerEmail: 'o***@example.com', apiKey: REDACTED }],
    });
  });

  it('redacts sensitive keys whose value is not a string', () => {
    expect(maskDeep({ phone: 5550100123, password: null, owner: { email: undefined } })).toEqual({
      phone: REDACTED,
      password: REDACTED,
      owner: { email: REDACTED },
    });
  });

  it('leaves non-sensitive fields untouched', () => {
    const input = { businessName: 'Example Coffee LLC', status: 'DRAFT', volumeCents: 1_250_000 };
    expect(maskDeep(input)).toEqual(input);
  });

  it('does not mutate its input', () => {
    const input = { password: 'hunter2', nested: { email: 'jane@example.com' } };
    const snapshot = structuredClone(input);
    maskDeep(input);
    expect(input).toEqual(snapshot);
  });

  it('passes primitives and class instances through unchanged', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    expect(maskDeep('text')).toBe('text');
    expect(maskDeep(42)).toBe(42);
    expect(maskDeep(null)).toBeNull();
    expect(maskDeep({ createdAt: date })).toEqual({ createdAt: date });
  });
});
