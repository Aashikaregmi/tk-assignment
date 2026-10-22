import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';

const derive = promisify(argon2);

// OWASP minimum for argon2id: 19 MiB, 2 passes, 1 lane.
const MEMORY_KIB = 19456;
const PASSES = 2;
const PARALLELISM = 1;

// PHC string format, as written by the reference implementation and the argon2 npm package.
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await derive('argon2id', {
      message: password,
      nonce: salt,
      memory: MEMORY_KIB,
      passes: PASSES,
      parallelism: PARALLELISM,
      tagLength: 32,
    });
    return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${unpadded(salt)}$${unpadded(hash)}`;
  }

  // Uses the parameters stored in the hash, so older hashes still verify after tuning.
  async verify(encoded: string, password: string): Promise<boolean> {
    const match = PHC.exec(encoded);
    if (!match) return false;
    const [memory, passes, parallelism, salt, hash] = match.slice(1) as [
      string,
      string,
      string,
      string,
      string,
    ];
    const expected = Buffer.from(hash, 'base64');
    const actual = await derive('argon2id', {
      message: password,
      nonce: Buffer.from(salt, 'base64'),
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
      tagLength: expected.length,
    });
    return timingSafeEqual(actual, expected);
  }
}

function unpadded(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}
