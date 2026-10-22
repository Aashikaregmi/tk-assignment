import { ApplicationStatus } from './application-status';
import { ApplicationNotEditable, InvalidApplicationData, InvalidStatusTransition } from './errors';
import {
  ApplicationDetails,
  MerchantApplication,
  MerchantApplicationState,
} from './merchant-application';
import { OwnerContact } from './owner-contact';
import { ProcessingInfo } from './processing-info';

const APP_ID = '7b0f6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b';
const SALES_ID = '3f1c2b9e-8d4a-4c1e-9f6b-2a7d5e8c0b14';

// Fake data only.
const details: ApplicationDetails = {
  businessName: 'Example Coffee',
  legalBusinessName: 'Example Coffee LLC',
  businessType: 'LLC',
  ownerContact: new OwnerContact({
    fullName: 'Jane Example',
    email: 'jane@example.com',
    phone: '+15550100123',
  }),
  processingInfo: new ProcessingInfo({
    monthlyVolumeCents: 2_500_000,
    averageTicketCents: 4_500,
    mcc: '5812',
  }),
};

function stored(overrides: Partial<MerchantApplicationState> = {}): MerchantApplication {
  return MerchantApplication.reconstitute({
    ...details,
    id: APP_ID,
    createdBy: SALES_ID,
    status: 'DRAFT',
    riskStatus: 'NOT_STARTED',
    assignedReviewerId: null,
    submissionNo: 0,
    ...overrides,
  });
}

describe('MerchantApplication', () => {
  describe('create', () => {
    it('starts as a DRAFT with no risk review and records ApplicationCreated', () => {
      const application = MerchantApplication.create(APP_ID, SALES_ID, details);

      expect(application.toState()).toEqual({
        ...details,
        id: APP_ID,
        createdBy: SALES_ID,
        status: 'DRAFT',
        riskStatus: 'NOT_STARTED',
        assignedReviewerId: null,
        submissionNo: 0,
      });
      expect(application.pullEvents()).toEqual([
        { type: 'ApplicationCreated', aggregateId: APP_ID, createdBy: SALES_ID },
      ]);
    });

    it('trims business names', () => {
      const application = MerchantApplication.create(APP_ID, SALES_ID, {
        ...details,
        businessName: '  Example Coffee ',
      });
      expect(application.toState().businessName).toBe('Example Coffee');
    });

    it.each<[string, Partial<ApplicationDetails>, RegExp]>([
      ['an empty business name', { businessName: ' ' }, /businessName/],
      [
        'a legal name over 200 characters',
        { legalBusinessName: 'x'.repeat(201) },
        /legalBusinessName/,
      ],
      ['an unknown business type', { businessType: 'TRUST' as never }, /businessType/],
    ])('rejects %s', (_case, override, message) => {
      const create = () =>
        MerchantApplication.create(APP_ID, SALES_ID, { ...details, ...override });
      expect(create).toThrow(InvalidApplicationData);
      expect(create).toThrow(message);
    });
  });

  describe('update', () => {
    it.each<ApplicationStatus>(['DRAFT', 'INFO_REQUESTED'])(
      'applies changes in %s and records the changed field names',
      (status) => {
        const application = stored({ status });

        application.update({ businessName: 'Example Roasters', legalBusinessName: undefined });

        expect(application.toState()).toMatchObject({
          businessName: 'Example Roasters',
          legalBusinessName: 'Example Coffee LLC',
        });
        expect(application.pullEvents()).toEqual([
          { type: 'ApplicationUpdated', aggregateId: APP_ID, fields: ['businessName'] },
        ]);
      },
    );

    it('records nothing when nothing changes', () => {
      const application = stored();
      application.update({});
      expect(application.pullEvents()).toEqual([]);
    });

    it('validates the merged details', () => {
      expect(() => stored().update({ businessName: '' })).toThrow(InvalidApplicationData);
    });

    it.each<ApplicationStatus>(['SUBMITTED', 'APPROVED', 'REJECTED'])(
      'refuses edits in %s',
      (status) => {
        const application = stored({ status });

        expect(() => application.update({ businessName: 'Changed' })).toThrow(
          ApplicationNotEditable,
        );
        expect(application.toState().businessName).toBe('Example Coffee');
      },
    );
  });

  describe('submit', () => {
    it('moves a DRAFT to SUBMITTED, starts a risk review and records the submission number', () => {
      const application = stored();

      application.submit();

      expect(application.toState()).toMatchObject({
        status: 'SUBMITTED',
        riskStatus: 'PENDING',
        submissionNo: 1,
      });
      expect(application.pullEvents()).toEqual([
        { type: 'ApplicationSubmitted', aggregateId: APP_ID, submissionNo: 1 },
      ]);
    });

    it('resubmits after INFO_REQUESTED as a new submission, keeping the reviewer', () => {
      const reviewerId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
      const application = stored({
        status: 'INFO_REQUESTED',
        riskStatus: 'LOW',
        submissionNo: 1,
        assignedReviewerId: reviewerId,
      });

      application.submit();

      expect(application.toState()).toMatchObject({
        status: 'SUBMITTED',
        riskStatus: 'PENDING',
        submissionNo: 2,
        assignedReviewerId: reviewerId,
      });
    });

    it.each<ApplicationStatus>(['SUBMITTED', 'APPROVED', 'REJECTED'])(
      'refuses to submit from %s',
      (status) => {
        const application = stored({ status, submissionNo: 1 });

        expect(() => application.submit()).toThrow(InvalidStatusTransition);
        expect(application.toState()).toMatchObject({ status, submissionNo: 1 });
        expect(application.pullEvents()).toEqual([]);
      },
    );
  });

  it('records no events when rebuilt from storage', () => {
    expect(stored({ status: 'SUBMITTED' }).pullEvents()).toEqual([]);
  });

  it('hands out copies of its state', () => {
    const application = stored();
    application.toState().status = 'APPROVED';
    expect(application.status).toBe('DRAFT');
  });
});
