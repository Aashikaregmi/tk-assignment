import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_PAGE_SIZE } from '../application/application-queries';
import { APPLICATION_STATUSES, RISK_STATUSES } from '../domain/application-status';
import type { ApplicationStatus, RiskStatus } from '../domain/application-status';
import { BUSINESS_TYPES } from '../domain/merchant-application';
import type { BusinessType } from '../domain/merchant-application';

// DTOs check shape and types (400). Content rules live in the domain (422), so they're written once.
// status, createdBy and assignedReviewerId aren't declared, so the global pipe rejects them.

class OwnerContactDto {
  @ApiProperty({ example: 'Jane Example' })
  @IsString()
  fullName!: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsString()
  email!: string;

  @ApiProperty({ example: '+15550100123', description: 'E.164' })
  @IsString()
  phone!: string;
}

class ProcessingInfoDto {
  @ApiProperty({ example: 2_500_000, description: 'Integer cents' })
  @IsInt()
  monthlyVolumeCents!: number;

  @ApiProperty({ example: 4_500, description: 'Integer cents, at most monthlyVolumeCents' })
  @IsInt()
  averageTicketCents!: number;

  @ApiProperty({ example: '5812', description: '4-digit merchant category code' })
  @IsString()
  mcc!: string;
}

export class CreateApplicationDto {
  @ApiProperty({ example: 'Example Coffee' })
  @IsString()
  businessName!: string;

  @ApiProperty({ example: 'Example Coffee LLC' })
  @IsString()
  legalBusinessName!: string;

  @ApiProperty({ enum: BUSINESS_TYPES, example: 'LLC' })
  @IsIn(BUSINESS_TYPES)
  businessType!: BusinessType;

  @IsObject()
  @ValidateNested()
  @Type(() => OwnerContactDto)
  ownerContact!: OwnerContactDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ProcessingInfoDto)
  processingInfo!: ProcessingInfoDto;
}

// Every field optional; nested objects are replaced whole.
export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}

export class ListApplicationsDto {
  @ApiProperty({ enum: APPLICATION_STATUSES, required: false })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 20;
}

export class ApplicationResponse {
  id!: string;
  businessName!: string;
  legalBusinessName!: string;

  @ApiProperty({ enum: BUSINESS_TYPES })
  businessType!: BusinessType;

  ownerContact!: OwnerContactDto;
  processingInfo!: ProcessingInfoDto;

  @ApiProperty({ enum: APPLICATION_STATUSES })
  status!: ApplicationStatus;

  @ApiProperty({ enum: RISK_STATUSES })
  riskStatus!: RiskStatus;

  createdBy!: string;

  @ApiProperty({ type: String, nullable: true })
  assignedReviewerId!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export class ApplicationPageResponse {
  items!: ApplicationResponse[];
  total!: number;
  page!: number;
  limit!: number;
}
