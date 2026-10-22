import type { ApplicationDetails, BusinessType } from '../domain/merchant-application';
import { OwnerContact, OwnerContactProps } from '../domain/owner-contact';
import { ProcessingInfo, ProcessingInfoProps } from '../domain/processing-info';

// Plain data from the API; turned into validated value objects here.
export interface ApplicationDetailsInput {
  businessName: string;
  legalBusinessName: string;
  businessType: BusinessType;
  ownerContact: OwnerContactProps;
  processingInfo: ProcessingInfoProps;
}

export function toDetails(input: ApplicationDetailsInput): ApplicationDetails {
  return {
    ...input,
    ownerContact: new OwnerContact(input.ownerContact),
    processingInfo: new ProcessingInfo(input.processingInfo),
  };
}

// Nested objects are replaced whole, never merged field by field.
export function toChanges(input: Partial<ApplicationDetailsInput>): Partial<ApplicationDetails> {
  return {
    ...input,
    ownerContact: input.ownerContact && new OwnerContact(input.ownerContact),
    processingInfo: input.processingInfo && new ProcessingInfo(input.processingInfo),
  };
}
