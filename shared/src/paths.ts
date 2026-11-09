/** Firestore document paths. One place, so web, rules tests and Apps Script agree. */
export const paths = {
  user: (uid: string) => `users/${uid}`,
  workspaceCreators: () => 'appConfig/workspaceCreators',
  workspace: (wid: string) => `workspaces/${wid}`,
  members: (wid: string) => `workspaces/${wid}/members`,
  member: (wid: string, uid: string) => `workspaces/${wid}/members/${uid}`,
  invites: (wid: string) => `workspaces/${wid}/invites`,
  invite: (wid: string, emailLower: string) => `workspaces/${wid}/invites/${emailLower}`,
  folders: (wid: string) => `workspaces/${wid}/folders`,
  folder: (wid: string, fid: string) => `workspaces/${wid}/folders/${fid}`,
  boards: (wid: string) => `workspaces/${wid}/boards`,
  board: (wid: string, bid: string) => `workspaces/${wid}/boards/${bid}`,
  notifications: (wid: string, uid: string) => `workspaces/${wid}/notifications/${uid}/items`,
  notification: (wid: string, uid: string, nid: string) =>
    `workspaces/${wid}/notifications/${uid}/items/${nid}`,
  updates: (wid: string, bid: string, iid: string) =>
    `workspaces/${wid}/boards/${bid}/items/${iid}/updates`,
  update: (wid: string, bid: string, iid: string, uid: string) =>
    `workspaces/${wid}/boards/${bid}/items/${iid}/updates/${uid}`,
} as const;

/** Extracts the workspace id from a member/invite document path. */
export function workspaceIdFromPath(path: string): string | null {
  const m = /^workspaces\/([^/]+)\//.exec(path);
  return m?.[1] ?? null;
}
