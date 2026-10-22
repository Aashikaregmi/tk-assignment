import { InvalidApplicationData } from './errors';
import { OwnerContact, OwnerContactProps } from './owner-contact';

// Fake: example.com and the fictional 555-01xx range.
const valid: OwnerContactProps = {
  fullName: 'Jane Example',
  email: 'jane@example.com',
  phone: '+15550100123',
};

describe('OwnerContact', () => {
  it('keeps valid values, trimming name and email', () => {
    const contact = new OwnerContact({
      ...valid,
      fullName: '  Jane Example ',
      email: ' jane@example.com',
    });
    expect(contact).toEqual(valid);
  });

  it.each<[string, Partial<OwnerContactProps>, RegExp]>([
    ['an empty name', { fullName: '   ' }, /fullName/],
    ['a name over 200 characters', { fullName: 'x'.repeat(201) }, /fullName/],
    ['an email without a domain', { email: 'jane@' }, /email/],
    ['an email with spaces', { email: 'jane doe@example.com' }, /email/],
    ['a phone without a country code', { phone: '5550100123' }, /phone/],
    ['a phone with separators', { phone: '+1 555 010 0123' }, /phone/],
    ['a phone over 15 digits', { phone: '+1555010012345678' }, /phone/],
  ])('rejects %s', (_case, override, message) => {
    const create = () => new OwnerContact({ ...valid, ...override });
    expect(create).toThrow(InvalidApplicationData);
    expect(create).toThrow(message);
  });

  it('never puts the rejected value in the error message', () => {
    expect(() => new OwnerContact({ ...valid, email: 'secret.person@nowhere' })).not.toThrow(
      /secret\.person/,
    );
  });
});
