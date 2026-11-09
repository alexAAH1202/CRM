export const ROLES = ['admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function canWrite(role: Role): boolean {
  return role === 'admin' || role === 'member';
}

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}
