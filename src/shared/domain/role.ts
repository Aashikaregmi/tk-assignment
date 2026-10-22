export const ROLES = ['ADMIN', 'REVIEWER', 'SALES'] as const;

export type Role = (typeof ROLES)[number];

// The authenticated user a request acts as.
export interface Actor {
  readonly id: string;
  readonly role: Role;
}
