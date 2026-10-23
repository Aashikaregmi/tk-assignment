import { Injectable } from '@nestjs/common';
import { AuditWriter } from '@modules/audit';
import { DomainEventPublisher } from '../application/domain-event-publisher';
import type { ApplicationEvent } from '../domain/events';

@Injectable()
export class AuditEventPublisher implements DomainEventPublisher {
  constructor(private readonly audit: AuditWriter) {}

  async publish(actorId: string | null, events: readonly ApplicationEvent[]): Promise<void> {
    for (const { type, aggregateId, ...metadata } of events) {
      await this.audit.write({
        actorId,
        action: type,
        entityType: 'MerchantApplication',
        entityId: aggregateId,
        metadata,
      });
    }
  }
}
