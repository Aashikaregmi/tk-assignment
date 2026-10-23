import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListAuditDto {
  @ApiProperty({ required: false, format: 'uuid', description: 'Only entries about this entity' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class AuditEntryResponse {
  @ApiProperty({ description: 'Ascending in insertion order; a string because it is a bigint' })
  id!: string;

  occurredAt!: Date;

  @ApiProperty({ type: String, nullable: true, description: 'Null when the system acted' })
  actorId!: string | null;

  @ApiProperty({ example: 'ApplicationDecided' })
  action!: string;

  @ApiProperty({ example: 'MerchantApplication' })
  entityType!: string;

  entityId!: string;

  @ApiProperty({ type: Object, example: { decision: 'APPROVE', reason: null } })
  metadata!: Record<string, unknown>;
}

export class AuditPageResponse {
  items!: AuditEntryResponse[];
  total!: number;
  page!: number;
  limit!: number;
}
