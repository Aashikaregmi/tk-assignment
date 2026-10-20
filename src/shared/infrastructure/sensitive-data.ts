// Substring match. Lists ids we don't collect so a field added later is redacted by default.
const SECRET_KEY_PARTS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'accountnumber',
  'routingnumber',
  'cardnumber',
];

// Suffix match for short ids that false-positive as substrings (busine-ssn-ame, syn-taxid-entifier).
const SECRET_KEY_SUFFIXES = ['ssn', 'taxid', 'cvv'];

// Suffix match (ownerEmail, contactPhone): personal data, partially masked.
const PII_KEY_SUFFIXES = ['email', 'phone', 'fullname'] as const;

export type Sensitivity = 'secret' | (typeof PII_KEY_SUFFIXES)[number] | undefined;

export function sensitivityOf(key: string): Sensitivity {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (
    SECRET_KEY_PARTS.some((part) => normalized.includes(part)) ||
    SECRET_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    return 'secret';
  }
  return PII_KEY_SUFFIXES.find((suffix) => normalized.endsWith(suffix));
}

export const REDACTED = '[REDACTED]';

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email.charAt(0)}***${email.slice(at)}` : maskText(email);
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
}

function maskText(text: string): string {
  return `${text.charAt(0)}***`;
}

// Returns a masked copy of JSON-like data; class instances (Date, Error, ...) pass through unchanged.
export function maskDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, maskEntry(key, v)]));
}

function maskEntry(key: string, value: unknown): unknown {
  const sensitivity = sensitivityOf(key);
  if (sensitivity === undefined) return maskDeep(value);
  if (sensitivity === 'secret' || typeof value !== 'string') return REDACTED;
  if (sensitivity === 'email') return maskEmail(value);
  if (sensitivity === 'phone') return maskPhone(value);
  return maskText(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
