import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@modules/identity';
import { AuditReader } from './audit-reader';
import { AuditPageResponse, ListAuditDto } from './audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly reader: AuditReader) {}

  @Get()
  @Roles('ADMIN')
  @ApiOkResponse({ type: AuditPageResponse })
  @ApiForbiddenResponse({ description: 'ADMIN only' })
  list(@Query() { entityId, page, limit }: ListAuditDto): Promise<AuditPageResponse> {
    return this.reader.list({ entityId, page, limit });
  }
}
