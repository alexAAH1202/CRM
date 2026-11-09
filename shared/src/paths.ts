/** Firestore document paths. One place, so web, rules tests and Apps Script agree. */
export const paths = {
  user: (uid: string) => `users/${uid}`,
  workspaceCreators: () => 'appConfig/workspaceCreators',
  workspace: (wid: string) => `workspaces/${wid}`,
  members: (wid: string) => `workspaces/${wid}/members`,
  member: (wid: string, uid: string) => `workspaces/${wid}/members/${uid}`,
  invites: (wid: string) => `workspaces/${wid}/invites`,
  invite: (wid: string, emailLower: string) => `workspaces/${wid}/invites/${emailLower}`,
  boards: (wid: string) => `workspaces/${wid}/boards`,
  board: (wid: string, bid: string) => `workspaces/${wid}/boards/${bid}`,
} as const;

/** Extracts the workspace id from a member/invite document path. */
export function workspaceIdFromPath(path: string): string | null {
  const m = /^workspaces\/([^/]+)\//.exec(path);
  return m?.[1] ?? null;
}
