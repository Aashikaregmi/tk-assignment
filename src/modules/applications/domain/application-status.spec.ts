import { APPLICATION_STATUSES, canTransition } from './application-status';

// Written out by hand, not derived from the production table.
const ALLOWED = new Set([
  'DRAFT→SUBMITTED',
  'SUBMITTED→APPROVED',
  'SUBMITTED→REJECTED',
  'SUBMITTED→INFO_REQUESTED',
  'INFO_REQUESTED→SUBMITTED',
]);

const ALL_PAIRS = APPLICATION_STATUSES.flatMap((from) =>
  APPLICATION_STATUSES.map((to) => [from, to] as const),
);

describe('canTransition', () => {
  it('covers all 25 status pairs', () => {
    expect(ALL_PAIRS).toHaveLength(25);
  });

  it.each(ALL_PAIRS)('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(ALLOWED.has(`${from}→${to}`));
  });
});
