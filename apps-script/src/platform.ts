/**
 * Everything the helper needs from Apps Script, behind one small interface, so the real logic
 * (auth, Firestore, routing) runs unchanged in Node tests with fakes. `gas.ts` is the only file
 * that touches UrlFetchApp / CacheService / PropertiesService.
 */
export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** Send the script owner's OAuth token (for Firestore / Drive). */
  oauth?: boolean;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export interface Platform {
  http(req: HttpRequest): HttpResponse;
  cacheGet(key: string): string | null;
  cachePut(key: string, value: string, ttlSeconds: number): void;
  prop(name: string): string | null;
  nowMs(): number;
  /** A fresh random id (Apps Script: Utilities.getUuid()). */
  uuid(): string;
  sha256Hex(text: string): string;
  /** Decodes base64url text (as in a JWT segment) to a UTF-8 string. Apps Script has no atob(). */
  b64urlDecode(text: string): string;
  log(message: string): void;
}
