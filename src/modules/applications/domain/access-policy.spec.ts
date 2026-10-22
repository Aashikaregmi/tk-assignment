import type { Actor } from '@shared/domain/role';
import { assertCanAssign, assertCanEdit, assertCanRead, readScopeFor } from './access-policy';
import { ApplicationStatus } from './application-status';
import { ApplicationAccessDenied, ApplicationNotFound } from './errors';

const ADMIN: Actor = { id: 'admin-1', role: 'ADMIN' };
const SALES_A: Actor = { id: 'sales-a', role: 'SALES' };
const SALES_B: Actor = { id: 'sales-b', role: 'SALES' };
const REVIEWER: Actor = { id: 'reviewer-1', role: 'REVIEWER' };

const byA = (status: ApplicationStatus) => ({ createdBy: SALES_A.id, status });

type Outcome = 'ok' | typeof ApplicationNotFound | typeof ApplicationAccessDenied;

function expectOutcome(check: () => void, outcome: Outcome): void {
  if (outcome === 'ok') expect(check).not.toThrow();
  else expect(check).toThrow(outcome);
}

describe('readScopeFor', () => {
  it.each([
    [ADMIN, { kind: 'all' }],
    [SALES_A, { kind: 'createdBy', userId: 'sales-a' }],
    [REVIEWER, { kind: 'submittedOnly' }],
  ])('%o → %o', (actor, scope) => {
    expect(readScopeFor(actor)).toEqual(scope);
  });
});

describe('assertCanRead', () => {
  it.each<[string, Actor, ApplicationStatus, Outcome]>([
    ['ADMIN reads a draft', ADMIN, 'DRAFT', 'ok'],
    ['ADMIN reads a decided application', ADMIN, 'REJECTED', 'ok'],
    ['SALES reads their own draft', SALES_A, 'DRAFT', 'ok'],
    ['SALES reads their own submitted application', SALES_A, 'SUBMITTED', 'ok'],
    ["SALES cannot see another's draft", SALES_B, 'DRAFT', ApplicationNotFound],
    ["SALES cannot see another's submitted application", SALES_B, 'SUBMITTED', ApplicationNotFound],
    ['REVIEWER cannot see drafts', REVIEWER, 'DRAFT', ApplicationNotFound],
    ['REVIEWER reads submitted applications', REVIEWER, 'SUBMITTED', 'ok'],
    ['REVIEWER reads applications awaiting info', REVIEWER, 'INFO_REQUESTED', 'ok'],
    ['REVIEWER reads decided applications', REVIEWER, 'APPROVED', 'ok'],
  ])('%s', (_case, actor, status, outcome) => {
    expectOutcome(() => assertCanRead(actor, byA(status)), outcome);
  });
});

describe('assertCanEdit', () => {
  it.each<[string, Actor, ApplicationStatus, Outcome]>([
    ["ADMIN edits anyone's application", ADMIN, 'DRAFT', 'ok'],
    ['SALES edits their own application', SALES_A, 'INFO_REQUESTED', 'ok'],
    ["SALES gets 404, not 403, for another's application", SALES_B, 'DRAFT', ApplicationNotFound],
    ['REVIEWER cannot edit a visible application', REVIEWER, 'SUBMITTED', ApplicationAccessDenied],
    ['REVIEWER gets 404 for a draft it cannot see', REVIEWER, 'DRAFT', ApplicationNotFound],
  ])('%s', (_case, actor, status, outcome) => {
    expectOutcome(() => assertCanEdit(actor, byA(status)), outcome);
  });
});

describe('assertCanAssign', () => {
  it.each<[string, Actor, ApplicationStatus, Outcome]>([
    ['ADMIN assigns', ADMIN, 'SUBMITTED', 'ok'],
    ['SALES cannot assign on their own application', SALES_A, 'SUBMITTED', ApplicationAccessDenied],
    ["SALES gets 404 for another's application", SALES_B, 'SUBMITTED', ApplicationNotFound],
    ['REVIEWER cannot assign', REVIEWER, 'SUBMITTED', ApplicationAccessDenied],
  ])('%s', (_case, actor, status, outcome) => {
    expectOutcome(() => assertCanAssign(actor, byA(status)), outcome);
  });
});
