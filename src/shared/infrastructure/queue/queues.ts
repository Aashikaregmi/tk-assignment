import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConnectionOptions, DefaultJobOptions, Queue } from 'bullmq';
import { AppConfig } from '../config/app-config';

// One BullMQ queue per name, created on first use: a process that never queues never connects.
@Injectable()
export class Queues implements OnApplicationShutdown {
  readonly connection: ConnectionOptions;
  private readonly queues = new Map<string, Queue>();
  private readonly jobDefaults = new Map<string, DefaultJobOptions>();

  constructor(config: AppConfig) {
    this.connection = { host: config.REDIS_HOST, port: config.REDIS_PORT, db: config.REDIS_DB };
  }

  // Retries and retention for jobs added to a queue, set by the module that consumes it.
  define(name: string, jobDefaults: DefaultJobOptions): void {
    if (this.queues.has(name)) throw new Error(`Queue ${name} is already in use`);
    this.jobDefaults.set(name, jobDefaults);
  }

  get(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: this.jobDefaults.get(name),
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  // After every beforeApplicationShutdown hook, so producers (the outbox relay) have stopped.
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
