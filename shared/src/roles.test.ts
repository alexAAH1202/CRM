import { describe, expect, it } from 'vitest';
import { canWrite, isAdmin, isRole } from './roles';

describe('roles', () => {
  it('validates role strings', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('owner')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
  it('maps permissions', () => {
    expect(canWrite('viewer')).toBe(false);
    expect(canWrite('member')).toBe(true);
    expect(isAdmin('member')).toBe(false);
    expect(isAdmin('admin')).toBe(true);
  });
});
