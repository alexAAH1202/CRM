import { describe, expect, it } from 'vitest';
import { makeColumn, normalizeValue, type FileValue } from './columns';
import {
  cleanMimeType,
  formatBytes,
  isBlockedFileName,
  isPreviewable,
  MAX_FILE_BYTES,
  sanitizeFileName,
  uploadProblem,
} from './files';

describe('file names and limits', () => {
  it('sanitises names: no paths, control characters, leading dots; bounded; never empty', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('etc passwd');
    expect(sanitizeFileName('a\u0000b\nc.pdf')).toBe('a b c.pdf');
    expect(sanitizeFileName('.hidden')).toBe('hidden');
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName(42)).toBe('file');
    const long = sanitizeFileName(`${'x'.repeat(400)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(150);
    expect(long.endsWith('.pdf')).toBe(true);
  });
  it('blocks programs by extension, case-insensitively', () => {
    expect(isBlockedFileName('Setup.EXE')).toBe(true);
    expect(isBlockedFileName('run.sh')).toBe(true);
    expect(isBlockedFileName('invoice.pdf')).toBe(false);
    expect(isBlockedFileName('noextension')).toBe(false);
  });
  it('refuses empty, oversized, non-integer and blocked uploads', () => {
    expect(uploadProblem('a.pdf', 100)).toBeNull();
    expect(uploadProblem('a.pdf', MAX_FILE_BYTES)).toBeNull();
    expect(uploadProblem('a.pdf', MAX_FILE_BYTES + 1)).toMatch(/10 MB/);
    expect(uploadProblem('a.pdf', 0)).toMatch(/empty/);
    expect(uploadProblem('a.pdf', 1.5)).not.toBeNull();
    expect(uploadProblem('a.pdf', '5')).not.toBeNull();
    expect(uploadProblem('a.bat', 5)).toMatch(/can’t be uploaded/);
  });
  it('only passes well-formed mime types, and formats sizes', () => {
    expect(cleanMimeType('image/png')).toBe('image/png');
    expect(cleanMimeType('text/html; <x>')).toBe('application/octet-stream');
    expect(cleanMimeType(undefined)).toBe('application/octet-stream');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1048576)).toBe('5 MB');
    expect(isPreviewable('image/jpeg')).toBe(true);
    expect(isPreviewable('application/pdf')).toBe(true);
    expect(isPreviewable('text/plain')).toBe(false);
  });
});

describe('files column keeps upload details', () => {
  const col = makeColumn('files', 'Files');
  it('keeps valid details, drops invalid ones, and still accepts plain links', () => {
    const out = normalizeValue(col, [
      {
        name: 'a.pdf',
        url: 'https://drive.google.com/file/d/abc12345/view',
        driveFileId: 'abc12345',
        mimeType: 'application/pdf',
        size: 1234,
        addedBy: 'u1',
        addedAt: '2026-03-10T00:00:00Z',
      },
      { name: 'b', url: 'https://x.test/b', driveFileId: 'bad id!', mimeType: 'nope', size: -5 },
    ]) as FileValue[];
    expect(out[0]).toMatchObject({
      driveFileId: 'abc12345',
      mimeType: 'application/pdf',
      size: 1234,
    });
    expect(out[1]).toEqual({ name: 'b', url: 'https://x.test/b' });
  });
});
