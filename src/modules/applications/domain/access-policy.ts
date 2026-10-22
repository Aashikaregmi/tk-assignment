import type { Actor } from '@shared/domain/role';
import type { MerchantApplicationState } from './merchant-application';
import { ApplicationAccessDenied, ApplicationNotFound } from './errors';

type AccessView = Pick<MerchantApplicationState, 'createdBy' | 'status'>;

// Which applications an actor may see. Queries turn this into SQL so lists and lookups agree.
export type ReadScope =
  { kind: 'all' } | { kind: 'createdBy'; userId: string } | { kind: 'submittedOnly' };

export function readScopeFor(actor: Actor): ReadScope {
  switch (actor.role) {
    case 'ADMIN':
      return { kind: 'all' };
    case 'SALES':
      return { kind: 'createdBy', userId: actor.id };
    case 'REVIEWER':
      // Reviewers work the queue; drafts aren't ready for review.
      return { kind: 'submittedOnly' };
  }
}

export function canRead(actor: Actor, application: AccessView): boolean {
  const scope = readScopeFor(actor);
  switch (scope.kind) {
    case 'all':
      return true;
    case 'createdBy':
      return application.createdBy === scope.userId;
    case 'submittedOnly':
      return application.status !== 'DRAFT';
  }
}

export function canCreate(actor: Actor): boolean {
  return actor.role === 'SALES' || actor.role === 'ADMIN';
}

// Edit and submit. Whether the status allows it is the aggregate's rule.
export function canEdit(actor: Actor, application: AccessView): boolean {
  if (actor.role === 'ADMIN') return true;
  return actor.role === 'SALES' && application.createdBy === actor.id;
}

// Not visible → 404 (no existence leak); visible but not editable → 403.
export function assertCanRead(actor: Actor, application: AccessView): void {
  if (!canRead(actor, application)) throw new ApplicationNotFound();
}

export function assertCanCreate(actor: Actor): void {
  if (!canCreate(actor)) throw new ApplicationAccessDenied('create');
}

export function assertCanEdit(actor: Actor, application: AccessView): void {
  assertCanRead(actor, application);
  if (!canEdit(actor, application)) throw new ApplicationAccessDenied('edit');
}
