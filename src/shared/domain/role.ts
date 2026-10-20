export const ROLES = ['ADMIN', 'REVIEWER', 'SALES'] as const;

export type Role = (typeof ROLES)[number];
