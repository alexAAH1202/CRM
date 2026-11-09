/**
 * Apps Script helper web app — Phase 0 skeleton.
 *
 * The browser POSTs JSON with Content-Type text/plain (no CORS preflight; Apps
 * Script does not answer OPTIONS). Every request will carry a Firebase ID token
 * that is verified server-side in Phase 7. Until then only `ping` is answered.
 */

interface HelperRequest {
  action?: string;
}

interface HelperResponse {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

function jsonResponse(body: HelperResponse): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function parseRequest(e: GoogleAppsScript.Events.DoPost): HelperRequest | null {
  try {
    const parsed: unknown = JSON.parse(e.postData.contents);
    return typeof parsed === 'object' && parsed !== null ? (parsed as HelperRequest) : null;
  } catch {
    return null;
  }
}

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const req = parseRequest(e);
  if (!req)
    return jsonResponse({ ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } });
  switch (req.action) {
    case 'ping':
      return jsonResponse({ ok: true, data: { pong: true, at: new Date().toISOString() } });
    default:
      return jsonResponse({
        ok: false,
        error: { code: 'unknown_action', message: 'Unknown or unimplemented action' },
      });
  }
}
