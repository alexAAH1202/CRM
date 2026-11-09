import {
  HelperError,
  sanitizeFileName,
  uploadProblem,
  type FileValue,
  type UploadedFile,
} from '@app/shared';
import { callHelper } from '../../lib/helper';

/** Base64 of a slice of a file, without loading the whole file into memory. */
function sliceToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new HelperError('bad_request', 'Couldn’t read that file.'));
    r.onload = () => {
      const url = String(r.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    r.readAsDataURL(blob);
  });
}

export interface UploadHandlers {
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Uploads one file to the workspace's Drive folder through the helper, piece by piece.
 * Checks the obvious problems (size, type) before sending anything.
 */
export async function uploadToDrive(
  workspaceId: string,
  file: File,
  { onProgress, signal }: UploadHandlers = {},
): Promise<UploadedFile> {
  const problem = uploadProblem(file.name, file.size);
  if (problem) throw new HelperError('bad_request', problem);
  const start = await callHelper(
    'uploadStart',
    {
      workspaceId,
      name: sanitizeFileName(file.name),
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    },
    { retries: 1, timeoutMs: 40_000, ...(signal ? { signal } : {}) },
  );
  let offset = 0;
  onProgress?.(0);
  while (offset < file.size) {
    if (signal?.aborted) throw new HelperError('unavailable', 'Upload cancelled.');
    const piece = file.slice(offset, Math.min(offset + start.chunkBytes, file.size));
    const data = await sliceToBase64(piece);
    const res = await callHelper(
      'uploadChunk',
      { workspaceId, uploadId: start.uploadId, offset, data },
      { retries: 3, timeoutMs: 60_000, ...(signal ? { signal } : {}) },
    );
    if (res.done) {
      onProgress?.(1);
      return res.file;
    }
    // The helper says where it is up to (normally right after this piece).
    offset = res.next;
    onProgress?.(offset / file.size);
  }
  throw new HelperError('internal', 'The upload ended before Drive confirmed it.');
}

/** The value stored on the item for an uploaded file. */
export function fileValueFor(f: UploadedFile, uid: string): FileValue {
  return {
    name: f.name,
    url: f.url,
    driveFileId: f.driveFileId,
    mimeType: f.mimeType,
    size: f.size,
    addedBy: uid,
    addedAt: new Date().toISOString(),
  };
}

/** Best-effort: make Drive's sharing match the members list (new joiner, role change, removal). */
export function requestFolderSync(workspaceId: string): void {
  callHelper('syncFolderSharing', { workspaceId }, { retries: 0 }).catch(() => {
    /* the daily run will catch up */
  });
}
