/**
 * Everything the helper needs from Apps Script, behind one small interface, so the real logic
 * (auth, Firestore, routing) runs unchanged in Node tests with fakes. `gas.ts` is the only file
 * that touches UrlFetchApp / CacheService / PropertiesService.
 */
export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** Send the script owner's OAuth token (for Firestore / Drive). */
  oauth?: boolean;
  /** Raw bytes, base64-encoded (used instead of `body`; for Drive uploads). */
  bodyBase64?: string;
  /** Default true. Drive's resumable uploads answer 308, which must not be followed. */
  followRedirects?: boolean;
}

export interface HttpResponse {
  status: number;
  body: string;
  /** Response headers, names lower-cased (only where a caller needs one, e.g. Location). */
  headers?: Record<string, string>;
}

export interface Platform {
  http(req: HttpRequest): HttpResponse;
  cacheGet(key: string): string | null;
  cachePut(key: string, value: string, ttlSeconds: number): void;
  prop(name: string): string | null;
  /** Saves a Script Property (small bookkeeping: last run times, who got today's digest). */
  setProp(name: string, value: string): void;
  /** Sends a plain-text + HTML email as the script owner. */
  sendMail(mail: { to: string; subject: string; text: string; html: string }): void;
  /** How many more emails Google will let the script send today. */
  mailQuota(): number;
  nowMs(): number;
  /** A fresh random id (Apps Script: Utilities.getUuid()). */
  uuid(): string;
  sha256Hex(text: string): string;
  /** Decodes base64url text (as in a JWT segment) to a UTF-8 string. Apps Script has no atob(). */
  b64urlDecode(text: string): string;
  log(message: string): void;
}
