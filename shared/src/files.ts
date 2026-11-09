import { LIMITS } from './constants';

/** What the helper reports about a file it has put in Drive. */
export interface UploadedFile {
  driveFileId: string;
  name: string;
  mimeType: string;
  size: number;
  /** The Drive "view" link (opens for anyone the workspace folder is shared with). */
  url: string;
}

export const MAX_FILE_BYTES = LIMITS.MAX_FILE_MB * 1024 * 1024;

/**
 * Pieces are sent as base64 inside one request (Apps Script caps request size), so a piece is
 * 1 MiB of file = ~1.4 MB of text. Drive's resumable protocol wants multiples of 256 KiB.
 */
export const UPLOAD_CHUNK_BYTES = 1024 * 1024;

/** Types that run code when opened; refused outright (this is a household filing cabinet). */
const BLOCKED_EXTENSIONS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'jar',
  'apk',
  'dmg',
  'app',
  'sh',
  'reg',
  'lnk',
  'dll',
  'hta',
]);

/** A safe display/file name: no path parts or control characters, bounded, never empty. */
export function sanitizeFileName(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : '';
  s = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^[.\s]+/, '');
  if (s.length > 150) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, 150 - ext.length).trimEnd() + ext;
  }
  return s || 'file';
}

export function isBlockedFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && BLOCKED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Reasons an upload can be refused before any bytes move (shared by the app and the helper). */
export function uploadProblem(name: unknown, size: unknown): string | null {
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0)
    return 'That file’s size isn’t valid.';
  if (size === 0) return 'That file is empty.';
  if (size > MAX_FILE_BYTES) return `Files can be up to ${LIMITS.MAX_FILE_MB} MB.`;
  if (isBlockedFileName(sanitizeFileName(name)))
    return 'That type of file can’t be uploaded (it could run programs).';
  return null;
}

/** Only well-formed MIME types are passed on; anything else becomes a generic binary type. */
export function cleanMimeType(raw: unknown): string {
  return typeof raw === 'string' && raw.length <= 100 && /^[\w.+-]+\/[\w.+-]+$/.test(raw)
    ? raw
    : 'application/octet-stream';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}

export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}
/** Drive's embeddable preview (images, PDFs, most documents). */
export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}
export function isPreviewable(mimeType: string | undefined): boolean {
  return !!mimeType && (mimeType.startsWith('image/') || mimeType === 'application/pdf');
}
