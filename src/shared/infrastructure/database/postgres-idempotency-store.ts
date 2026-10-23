import { Injectable } from '@nestjs/common';
import { IdempotencyStore, StoredRequest } from '../../application/idempotency-store';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

// Plain SQL: ON CONFLICT ... RETURNING says exactly what happens, which the ORM would hide.
@Injectable()
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  // A concurrent insert of the same key blocks on the primary key until the other transaction
  // ends: if it committed, DO NOTHING and we read its response; if it rolled back, we insert.
  async claim(userId: string, key: string, requestHash: string): Promise<StoredRequest | null> {
    const inserted = await this.uow.manager.query<unknown[]>(
      `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING key`,
      [userId, key, requestHash],
    );
    if (inserted.length > 0) return null;
    const [existing] = await this.uow.manager.query<
      { request_hash: string; response_body: unknown }[]
    >('SELECT request_hash, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2', [
      userId,
      key,
    ]);
    return { requestHash: existing!.request_hash, responseBody: existing!.response_body };
  }

  async complete(userId: string, key: string, responseBody: unknown): Promise<void> {
    await this.uow.manager.query(
      'UPDATE idempotency_keys SET response_body = $3 WHERE user_id = $1 AND key = $2',
      [userId, key, JSON.stringify(responseBody ?? null)],
    );
  }
}
