const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id for columns, groups, labels (unique within a board). */
export function shortId(len = 8): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
