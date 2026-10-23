import { Module } from '@nestjs/common';
import { OutboxRelay } from './outbox-relay';
import { OutboxWriter } from './outbox-writer';

@Module({
  providers: [OutboxWriter, OutboxRelay],
  exports: [OutboxWriter],
})
export class OutboxModule {}
