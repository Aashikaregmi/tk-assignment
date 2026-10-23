import { MerchantApplication } from '../domain/merchant-application';
import { OwnerContact } from '../domain/owner-contact';
import { ProcessingInfo } from '../domain/processing-info';
import { ApplicationOrmEntity } from './application.orm-entity';

export type ApplicationRow = Omit<ApplicationOrmEntity, 'createdAt' | 'updatedAt'>;

export function toDomain(row: ApplicationOrmEntity): MerchantApplication {
  return MerchantApplication.reconstitute({
    id: row.id,
    createdBy: row.createdBy,
    businessName: row.businessName,
    legalBusinessName: row.legalBusinessName,
    businessType: row.businessType,
    ownerContact: new OwnerContact({
      fullName: row.ownerFullName,
      email: row.ownerEmail,
      phone: row.ownerPhone,
    }),
    processingInfo: new ProcessingInfo({
      monthlyVolumeCents: row.monthlyVolumeCents,
      averageTicketCents: row.averageTicketCents,
      mcc: row.mcc,
    }),
    status: row.status,
    riskStatus: row.riskStatus,
    assignedReviewerId: row.assignedReviewerId,
    submissionNo: row.submissionNo,
    decisionReason: row.decisionReason,
  });
}

// Timestamps are left to the database (DEFAULT now()) and TypeORM (updated_at on UPDATE).
export function toRow(application: MerchantApplication): ApplicationRow {
  const { ownerContact, processingInfo, ...state } = application.toState();
  return {
    ...state,
    ownerFullName: ownerContact.fullName,
    ownerEmail: ownerContact.email,
    ownerPhone: ownerContact.phone,
    monthlyVolumeCents: processingInfo.monthlyVolumeCents,
    averageTicketCents: processingInfo.averageTicketCents,
    mcc: processingInfo.mcc,
  };
}
