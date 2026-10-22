import { PasswordHasher } from './password-hasher';

const REFERENCE_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Zml4ZWRzYWx0Zml4ZWRzYQ$Sekky2dPuvxvx/yFLTpDkps68RttvIx4U/NhaikW8T0';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('writes an argon2id PHC string and verifies it', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'correct horse battery stapl')).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [first, second] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);
    expect(first).not.toBe(second);
  });

  it('verifies hashes from the reference implementation', async () => {
    await expect(hasher.verify(REFERENCE_HASH, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(REFERENCE_HASH, 'Correct horse battery staple')).resolves.toBe(
      false,
    );
  });

  it.each([
    ['plaintext', 'correct horse battery staple'],
    ['another algorithm', REFERENCE_HASH.replace('argon2id', 'argon2i')],
    ['an empty string', ''],
  ])('rejects %s without throwing', async (_case, stored) => {
    await expect(hasher.verify(stored, 'correct horse battery staple')).resolves.toBe(false);
  });
});
