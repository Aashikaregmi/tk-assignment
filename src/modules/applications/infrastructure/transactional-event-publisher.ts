import { Injectable } from '@nestjs/common';
import { AuditWriter } from '@modules/audit';
import { OutboxWriter } from '@modules/outbox';
import { DomainEventPublisher } from '../application/domain-event-publisher';
import type { ApplicationEvent } from '../domain/events';

const RISK_REVIEW_QUEUE = 'risk-review';

// Every event goes to the audit log; a submission also queues its risk review through the outbox.
// Both writes join the command's transaction.
@Injectable()
export class TransactionalEventPublisher implements DomainEventPublisher {
  constructor(
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async publish(actorId: string | null, events: readonly ApplicationEvent[]): Promise<void> {
    for (const event of events) {
      const { type, aggregateId, ...metadata } = event;
      await this.audit.write({
        actorId,
        action: type,
        entityType: 'MerchantApplication',
        entityId: aggregateId,
        metadata,
      });
      if (event.type === 'ApplicationSubmitted') {
        await this.outbox.write({
          queue: RISK_REVIEW_QUEUE,
          type,
          payload: { applicationId: aggregateId, submissionNo: event.submissionNo },
        });
      }
    }
  }
}
