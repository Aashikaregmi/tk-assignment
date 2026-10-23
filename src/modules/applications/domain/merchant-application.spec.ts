import type { Actor } from '@shared/domain/role';
import { ApplicationStatus, Decision, RiskStatus } from './application-status';
import {
  ApplicationNotAssignable,
  ApplicationNotEditable,
  InvalidApplicationData,
  InvalidStatusTransition,
  NotAssignedReviewer,
  RiskResultRequired,
} from './errors';
import {
  ApplicationDetails,
  MerchantApplication,
  MerchantApplicationState,
} from './merchant-application';
import { OwnerContact } from './owner-contact';
import { ProcessingInfo } from './processing-info';

const APP_ID = '7b0f6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b';
const SALES_ID = '3f1c2b9e-8d4a-4c1e-9f6b-2a7d5e8c0b14';
const REVIEWER: Actor = { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', role: 'REVIEWER' };
const OTHER_REVIEWER: Actor = { id: '1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a', role: 'REVIEWER' };

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
    decisionReason: null,
    ...overrides,
  });
}

// Submitted, assigned to REVIEWER, risk review finished.
const awaitingDecision = (overrides: Partial<MerchantApplicationState> = {}) =>
  stored({
    status: 'SUBMITTED',
    riskStatus: 'LOW',
    submissionNo: 1,
    assignedReviewerId: REVIEWER.id,
    ...overrides,
  });

function expectRefused(
  application: MerchantApplication,
  action: () => void,
  error: new (...args: never[]) => Error,
): void {
  const before = application.toState();
  expect(action).toThrow(error);
  expect(application.toState()).toEqual(before);
  expect(application.pullEvents()).toEqual([]);
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
        decisionReason: null,
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
      const application = awaitingDecision({
        status: 'INFO_REQUESTED',
        decisionReason: 'Please confirm the monthly volume',
      });

      application.submit();

      expect(application.toState()).toMatchObject({
        status: 'SUBMITTED',
        riskStatus: 'PENDING',
        submissionNo: 2,
        assignedReviewerId: REVIEWER.id,
        decisionReason: null,
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

  describe('assignReviewer', () => {
    it('assigns a reviewer to a submitted application', () => {
      const application = stored({ status: 'SUBMITTED', riskStatus: 'PENDING', submissionNo: 1 });

      application.assignReviewer(REVIEWER.id);

      expect(application.toState().assignedReviewerId).toBe(REVIEWER.id);
      expect(application.pullEvents()).toEqual([
        { type: 'ReviewerAssigned', aggregateId: APP_ID, reviewerId: REVIEWER.id },
      ]);
    });

    it('reassigns until decided', () => {
      const application = awaitingDecision();

      application.assignReviewer(OTHER_REVIEWER.id);

      expect(application.toState().assignedReviewerId).toBe(OTHER_REVIEWER.id);
      expect(application.pullEvents()).toEqual([
        { type: 'ReviewerAssigned', aggregateId: APP_ID, reviewerId: OTHER_REVIEWER.id },
      ]);
    });

    it('records nothing when the same reviewer is assigned again', () => {
      const application = awaitingDecision();
      application.assignReviewer(REVIEWER.id);
      expect(application.pullEvents()).toEqual([]);
    });

    it.each<ApplicationStatus>(['DRAFT', 'INFO_REQUESTED', 'APPROVED', 'REJECTED'])(
      'refuses in %s',
      (status) => {
        const application =
          status === 'DRAFT' ? stored() : awaitingDecision({ status, decisionReason: 'Reason' });
        expectRefused(
          application,
          () => application.assignReviewer(OTHER_REVIEWER.id),
          ApplicationNotAssignable,
        );
      },
    );
  });

  describe('decide', () => {
    it.each<[Decision, string | undefined, ApplicationStatus, string | null]>([
      ['APPROVE', undefined, 'APPROVED', null],
      ['APPROVE', ' Looks good ', 'APPROVED', 'Looks good'],
      ['REJECT', 'MCC not supported', 'REJECTED', 'MCC not supported'],
      ['REQUEST_INFO', 'Please confirm the volume', 'INFO_REQUESTED', 'Please confirm the volume'],
    ])('%s with reason %p → %s', (decision, reason, status, decisionReason) => {
      const application = awaitingDecision();

      application.decide(REVIEWER, decision, reason);

      expect(application.toState()).toMatchObject({ status, decisionReason });
      expect(application.pullEvents()).toEqual([
        { type: 'ApplicationDecided', aggregateId: APP_ID, decision, reason: decisionReason },
      ]);
    });

    it.each<[string, Actor, string | null]>([
      ['another reviewer', OTHER_REVIEWER, REVIEWER.id],
      ['any reviewer while unassigned', REVIEWER, null],
      ['ADMIN', { id: 'admin-1', role: 'ADMIN' }, REVIEWER.id],
      [
        'the assigned id with a role other than REVIEWER',
        { ...REVIEWER, role: 'ADMIN' },
        REVIEWER.id,
      ],
      ['the SALES creator', { id: SALES_ID, role: 'SALES' }, REVIEWER.id],
    ])('refuses %s', (_case, actor, assignedReviewerId) => {
      const application = awaitingDecision({ assignedReviewerId });
      expectRefused(application, () => application.decide(actor, 'APPROVE'), NotAssignedReviewer);
    });

    it.each<ApplicationStatus>(['DRAFT', 'INFO_REQUESTED', 'APPROVED', 'REJECTED'])(
      'refuses to decide in %s',
      (status) => {
        const application = awaitingDecision({ status, decisionReason: 'Reason' });
        expectRefused(
          application,
          () => application.decide(REVIEWER, 'REJECT', 'Again'),
          InvalidStatusTransition,
        );
      },
    );

    it.each<[RiskStatus, Decision, boolean]>([
      ['PENDING', 'APPROVE', false],
      ['PENDING', 'REJECT', false],
      ['PENDING', 'REQUEST_INFO', false],
      ['FAILED', 'APPROVE', false],
      ['FAILED', 'REJECT', true],
      ['FAILED', 'REQUEST_INFO', true],
      ['LOW', 'APPROVE', true],
      ['MEDIUM', 'APPROVE', true],
      ['HIGH', 'APPROVE', true],
    ])('risk %s, %s → allowed: %p', (riskStatus, decision, allowed) => {
      const application = awaitingDecision({ riskStatus });
      const act = () => application.decide(REVIEWER, decision, 'Reason');
      if (allowed) expect(act).not.toThrow();
      else expectRefused(application, act, RiskResultRequired);
    });

    it.each<[string, Decision, string | undefined, RegExp]>([
      ['a rejection without a reason', 'REJECT', undefined, /reason is required/],
      ['an info request with a blank reason', 'REQUEST_INFO', '   ', /reason is required/],
      ['a reason over 1000 characters', 'APPROVE', 'x'.repeat(1001), /at most 1000/],
    ])('refuses %s', (_case, decision, reason, message) => {
      const application = awaitingDecision();
      const act = () => application.decide(REVIEWER, decision, reason);
      expect(act).toThrow(message);
      expectRefused(application, act, InvalidApplicationData);
    });

    it('lets SALES edit and resubmit after an info request', () => {
      const application = awaitingDecision();
      application.decide(REVIEWER, 'REQUEST_INFO', 'Please confirm the volume');

      application.update({ businessName: 'Example Roasters' });
      application.submit();

      expect(application.toState()).toMatchObject({
        businessName: 'Example Roasters',
        status: 'SUBMITTED',
        riskStatus: 'PENDING',
        submissionNo: 2,
        assignedReviewerId: REVIEWER.id,
        decisionReason: null,
      });
    });
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
