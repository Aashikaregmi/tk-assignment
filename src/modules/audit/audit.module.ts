import { Module } from '@nestjs/common';
import { AuditReader } from './audit-reader';
import { AuditWriter } from './audit-writer';
import { AuditController } from './audit.controller';

@Module({
  controllers: [AuditController],
  providers: [AuditWriter, AuditReader],
  exports: [AuditWriter],
})
export class AuditModule {}
