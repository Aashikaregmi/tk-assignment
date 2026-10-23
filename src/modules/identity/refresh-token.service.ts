import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuditWriter } from '@modules/audit';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { IsNull } from 'typeorm';
import { RefreshTokenOrmEntity } from './refresh-token.orm-entity';

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

// SHA-256, not argon2: the token is 256 random bits, so there is nothing to brute-force,
// and a fast deterministic hash can be looked up by index.
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

type Rotation =
  | { kind: 'rotated'; userId: string; refreshToken: string }
  | { kind: 'reused'; userId: string; familyId: string }
  | { kind: 'invalid' };

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly uow: TypeOrmUnitOfWork,
    private readonly audit: AuditWriter,
  ) {}

  // Each login starts a new family.
  issue(userId: string): Promise<string> {
    return this.uow.run(async () => (await this.create(userId, randomUUID())).token);
  }

  // Single use: the presented token is revoked and replaced by a new one in the same family.
  async rotate(token: string): Promise<{ userId: string; refreshToken: string }> {
    const rotation = await this.uow.run((): Promise<Rotation> => this.rotateLocked(token));
    if (rotation.kind === 'rotated') return rotation;
    if (rotation.kind === 'reused') {
      this.logger.warn(
        `Refresh token reuse for user ${rotation.userId}: family ${rotation.familyId} revoked`,
      );
    }
    // After the commit, so a detected reuse stays revoked. One answer for every failure.
    throw new UnauthorizedException('Invalid refresh token');
  }

  // Logout ends the whole family. Unknown or already revoked tokens are ignored.
  async revoke(token: string): Promise<void> {
    await this.uow.run(async () => {
      const current = await this.uow.manager.findOneBy(RefreshTokenOrmEntity, {
        tokenHash: hashOf(token),
      });
      if (current) await this.revokeFamily(current.familyId);
    });
  }

  // The row lock serializes refreshes of the same token: the second sees it revoked.
  private async rotateLocked(token: string): Promise<Rotation> {
    const current = await this.uow.manager.findOne(RefreshTokenOrmEntity, {
      where: { tokenHash: hashOf(token) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!current) return { kind: 'invalid' };

    // A revoked token came back: whoever holds the family's live token may be an attacker.
    if (current.revokedAt) {
      const { userId, familyId } = current;
      await this.revokeFamily(familyId);
      await this.audit.write({
        actorId: null,
        action: 'RefreshTokenReuseDetected',
        entityType: 'User',
        entityId: userId,
        metadata: { familyId },
      });
      return { kind: 'reused', userId, familyId };
    }
    if (current.expiresAt <= new Date()) return { kind: 'invalid' };

    const next = await this.create(current.userId, current.familyId);
    await this.uow.manager.update(RefreshTokenOrmEntity, current.id, {
      revokedAt: new Date(),
      replacedBy: next.id,
    });
    return { kind: 'rotated', userId: current.userId, refreshToken: next.token };
  }

  private async create(userId: string, familyId: string): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await this.uow.manager.insert(RefreshTokenOrmEntity, {
      id,
      userId,
      familyId,
      tokenHash: hashOf(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    return { id, token };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.uow.manager.update(
      RefreshTokenOrmEntity,
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
