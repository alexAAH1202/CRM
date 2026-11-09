import type { HttpRequest, HttpResponse, Platform } from './platform';

/** The real Apps Script implementation of the platform interface (the only file using its services). */
export function gasPlatform(): Platform {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  return {
    http(req: HttpRequest): HttpResponse {
      const headers: Record<string, string> = { ...(req.headers ?? {}) };
      if (req.oauth) headers['Authorization'] = `Bearer ${ScriptApp.getOAuthToken()}`;
      const res = UrlFetchApp.fetch(req.url, {
        method: (req.method ?? 'GET').toLowerCase() as GoogleAppsScript.URL_Fetch.HttpMethod,
        headers,
        ...(req.bodyBase64 !== undefined
          ? { payload: Utilities.newBlob(Utilities.base64Decode(req.bodyBase64)).getBytes() }
          : req.body !== undefined
            ? { payload: req.body }
            : {}),
        muteHttpExceptions: true,
        followRedirects: req.followRedirects ?? true,
      });
      const headers2: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.getAllHeaders()))
        headers2[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
      return { status: res.getResponseCode(), body: res.getContentText(), headers: headers2 };
    },
    cacheGet: (k) => cache.get(k),
    cachePut: (k, v, ttl) => {
      // CacheService values are limited to ~100 KB; our entries are tiny.
      cache.put(k, v, Math.min(ttl, 21600));
    },
    prop: (n) => props.getProperty(n),
    setProp: (n, v) => void props.setProperty(n, v),
    sendMail: (m) =>
      MailApp.sendEmail({
        to: m.to,
        subject: m.subject,
        body: m.text,
        htmlBody: m.html,
        name: 'Sorted',
        noReply: true,
      }),
    mailQuota: () => MailApp.getRemainingDailyQuota(),
    nowMs: () => Date.now(),
    uuid: () => Utilities.getUuid().replace(/-/g, ''),
    sha256Hex: (text) =>
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
        .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
        .join(''),
    b64urlDecode: (text) =>
      Utilities.newBlob(
        Utilities.base64DecodeWebSafe(text.padEnd(Math.ceil(text.length / 4) * 4, '=')),
      ).getDataAsString('UTF-8'),
    log: (m) => console.log(m),
  };
}
