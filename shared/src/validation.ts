import { z } from 'zod';
import { LIMITS } from './constants';
import { ROLES } from './roles';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.MAX_EMAIL_LENGTH)
  .email('Enter a valid email address');

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Give your household a name')
  .max(
    LIMITS.MAX_WORKSPACE_NAME_LENGTH,
    `Keep it under ${LIMITS.MAX_WORKSPACE_NAME_LENGTH} characters`,
  );

export const roleSchema = z.enum(ROLES);

export const inviteFormSchema = z.object({
  email: emailSchema,
  role: roleSchema,
});
export type InviteForm = z.infer<typeof inviteFormSchema>;

export const createWorkspaceFormSchema = z.object({
  name: workspaceNameSchema,
});
export type CreateWorkspaceForm = z.infer<typeof createWorkspaceFormSchema>;

/** Lowercase + trim; the canonical form used for invite document ids. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
