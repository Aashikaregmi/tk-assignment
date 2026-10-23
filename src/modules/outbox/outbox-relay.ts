import { setTimeout as sleep } from 'node:timers/promises';
import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { Queues } from '@shared/infrastructure/queue/queues';
import { In } from 'typeorm';
import { OutboxOrmEntity } from './outbox.orm-entity';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1000;

// The only way messages leave the database: after their transaction has committed.
@Injectable()
export class OutboxRelay implements BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly stop = new AbortController();
  private loop?: Promise<void>;

  constructor(
    private readonly uow: TypeOrmUnitOfWork,
    private readonly queues: Queues,
  ) {}

  // Called from main.ts, not on module init, so test apps don't poll in the background.
  start(): void {
    this.loop ??= this.poll();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stop.abort();
    await this.loop;
  }

  // SKIP LOCKED lets several instances relay side by side without sending a row twice.
  // A crash after add() but before commit re-sends the row; BullMQ ignores a repeated jobId.
  relayBatch(): Promise<number> {
    return this.uow.run(async () => {
      const rows = await this.uow.manager
        .createQueryBuilder(OutboxOrmEntity, 'message')
        .where('message.publishedAt IS NULL')
        .orderBy('message.createdAt')
        .limit(BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      for (const row of rows) {
        await this.queues.get(row.queue).add(row.type, row.payload, { jobId: row.id });
      }
      if (rows.length > 0) {
        await this.uow.manager.update(
          OutboxOrmEntity,
          { id: In(rows.map(({ id }) => id)) },
          { publishedAt: () => 'now()' },
        );
      }
      return rows.length;
    });
  }

  private async poll(): Promise<void> {
    while (!this.stop.signal.aborted) {
      try {
        await this.relayBatch();
      } catch (error) {
        // Message and stack only: driver errors can carry query parameters.
        this.logger.error('Outbox relay batch failed', (error as Error).stack);
      }
      await sleep(POLL_INTERVAL_MS, undefined, { signal: this.stop.signal }).catch(() => {});
    }
  }
}
