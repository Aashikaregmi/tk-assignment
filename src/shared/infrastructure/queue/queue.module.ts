import { Global, Module } from '@nestjs/common';
import { Queues } from './queues';

@Global()
@Module({
  providers: [Queues],
  exports: [Queues],
})
export class QueueModule {}
