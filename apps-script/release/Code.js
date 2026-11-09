/**
 * Sorted helper: GENERATED FILE. Do not edit here.
 * Source: apps-script/src (+ shared/src). Rebuild with `npm run build -w apps-script`.
 * Paste this whole file into the Apps Script editor's Code.gs (docs/SETUP.md B4.4).
 */
"use strict";
var Sorted = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/Code.ts
  var Code_exports = {};
  __export(Code_exports, {
    doGet: () => doGet,
    doPost: () => doPost,
    runDigest: () => runDigest,
    runHousekeeping: () => runHousekeeping,
    runScheduler: () => runScheduler,
    setup: () => setup
  });

  // ../shared/src/helperProtocol.ts
  var HelperError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code");
      this.name = "HelperError";
      this.code = code;
    }
  };
  var HELPER_VERSION = "7a.1";

  // src/config.ts
  var PROJECT_ID = "life-management-de315";
  var DEFAULT_API_KEY = "AIzaSyDaSy0Z-YZT4XK1283aF_ZUCkdN3xzHf1U";
  var DEFAULT_DRIVE_ROOT = "1RinTNsHtgeK0yjycf339SL0TQ3S7gRcV";
  var TIME_ZONE = "Australia/Melbourne";
  var VERSION = HELPER_VERSION;
  function loadConfig(p) {
    return {
      projectId: p.prop("FIREBASE_PROJECT_ID") ?? PROJECT_ID,
      apiKey: p.prop("FIREBASE_API_KEY") ?? DEFAULT_API_KEY,
      driveRootFolderId: p.prop("DRIVE_ROOT_FOLDER_ID") ?? DEFAULT_DRIVE_ROOT
    };
  }

  // src/gas.ts
  function gasPlatform() {
    const cache = CacheService.getScriptCache();
    const props = PropertiesService.getScriptProperties();
    return {
      http(req) {
        const headers = { ...req.headers ?? {} };
        if (req.oauth) headers["Authorization"] = `Bearer ${ScriptApp.getOAuthToken()}`;
        const res = UrlFetchApp.fetch(req.url, {
          method: (req.method ?? "GET").toLowerCase(),
          headers,
          ...req.body !== void 0 ? { payload: req.body } : {},
          muteHttpExceptions: true,
          followRedirects: true
        });
        return { status: res.getResponseCode(), body: res.getContentText() };
      },
      cacheGet: (k) => cache.get(k),
      cachePut: (k, v, ttl) => {
        cache.put(k, v, Math.min(ttl, 21600));
      },
      prop: (n) => props.getProperty(n),
      nowMs: () => Date.now(),
      sha256Hex: (text) => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join(""),
      b64urlDecode: (text) => Utilities.newBlob(
        Utilities.base64DecodeWebSafe(text.padEnd(Math.ceil(text.length / 4) * 4, "="))
      ).getDataAsString("UTF-8"),
      log: (m) => console.log(m)
    };
  }

  // src/auth.ts
  var ROLES = ["admin", "member", "viewer"];
  function jwtExpiry(p, token) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
      const exp = JSON.parse(p.b64urlDecode(parts[1])).exp;
      return typeof exp === "number" ? exp : null;
    } catch {
      return null;
    }
  }
  var CACHE_SECONDS = 300;
  function verifyIdToken(p, cfg, idToken) {
    if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 4096)
      throw new HelperError("unauthenticated", "Sign in again.");
    const exp = jwtExpiry(p, idToken);
    const now = p.nowMs();
    if (exp !== null && exp * 1e3 <= now)
      throw new HelperError("unauthenticated", "Your sign-in has expired. Reload the page.");
    const key = `tok:${p.sha256Hex(idToken)}`;
    const hit = p.cacheGet(key);
    if (hit) {
      try {
        return JSON.parse(hit);
      } catch {
      }
    }
    const res = p.http({
      url: `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    });
    if (res.status === 400 || res.status === 401 || res.status === 403)
      throw new HelperError(
        "unauthenticated",
        "Your sign-in could not be verified. Reload the page."
      );
    if (res.status !== 200) {
      p.log(`accounts:lookup returned ${res.status}`);
      throw new HelperError("unavailable", "Could not check your sign-in right now.");
    }
    let user;
    try {
      user = JSON.parse(res.body).users?.[0];
    } catch {
      user = void 0;
    }
    if (!user || typeof user.localId !== "string")
      throw new HelperError("unauthenticated", "Your sign-in could not be verified.");
    const caller = {
      uid: user.localId,
      email: typeof user.email === "string" ? user.email : null
    };
    const ttl = exp === null ? CACHE_SECONDS : Math.max(1, Math.min(CACHE_SECONDS, Math.floor(exp - now / 1e3)));
    p.cachePut(key, JSON.stringify(caller), ttl);
    return caller;
  }
  function roleIn(db, uid, workspaceId) {
    if (typeof workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId))
      throw new HelperError("bad_request", "A workspace is required.");
    const m = db.getDoc(`workspaces/${workspaceId}/members/${uid}`);
    const role = m?.data["role"];
    if (!m || typeof role !== "string" || !ROLES.includes(role))
      throw new HelperError("forbidden", "You are not a member of this workspace.");
    return role;
  }

  // src/firestoreCodec.ts
  function toValue(v) {
    if (v === null || v === void 0) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("Firestore cannot store NaN or Infinity");
      return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === "string") return { stringValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === "object")
      return { mapValue: { fields: toFields(v) } };
    throw new Error(`Cannot store a ${typeof v} in Firestore`);
  }
  function toFields(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (v !== void 0) out[k] = toValue(v);
    return out;
  }
  function fromValue(v) {
    if (!v) return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return v["booleanValue"] === true;
    if ("integerValue" in v) return Number(v["integerValue"]);
    if ("doubleValue" in v) return Number(v["doubleValue"]);
    if ("stringValue" in v) return String(v["stringValue"]);
    if ("timestampValue" in v) return new Date(String(v["timestampValue"]));
    if ("referenceValue" in v) return String(v["referenceValue"]);
    if ("bytesValue" in v) return String(v["bytesValue"]);
    if ("arrayValue" in v) {
      const vals = v["arrayValue"].values ?? [];
      return vals.map(fromValue);
    }
    if ("mapValue" in v) return fromFields(v["mapValue"].fields ?? {});
    return null;
  }
  function fromFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
    return out;
  }
  function decodeDoc(d) {
    const path = d.name.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, "");
    return {
      path,
      id: path.split("/").pop(),
      data: fromFields(d.fields ?? {}),
      updateTime: d.updateTime ?? null
    };
  }

  // src/firestore.ts
  var isSentinel = (v) => typeof v === "object" && v !== null && "__op" in v;
  var seg = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `\`${s.replace(/`/g, "\\`")}\``;
  var isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !isSentinel(v);
  function strip(v, path, transforms) {
    if (!isPlainObject(v)) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const here = [...path, k];
      if (isSentinel(x)) {
        const fp = here.map(seg).join(".");
        if (x.__op === "serverTime")
          transforms.push({ fieldPath: fp, setToServerValue: "REQUEST_TIME" });
        else if (x.__op === "arrayUnion")
          transforms.push({
            fieldPath: fp,
            appendMissingElements: { values: (x.values ?? []).map(toValue) }
          });
        else if (x.__op === "arrayRemove")
          transforms.push({
            fieldPath: fp,
            removeAllFromArray: { values: (x.values ?? []).map(toValue) }
          });
        continue;
      }
      out[k] = strip(x, here, transforms);
    }
    return out;
  }
  function walk(data, prefix, mask) {
    const value = {};
    const transforms = [];
    const paths = [];
    for (const [k, v] of Object.entries(data)) {
      const here = mask && k.includes(".") ? [...prefix, ...k.split(".")] : [...prefix, k];
      const fp = here.map(seg).join(".");
      if (isSentinel(v)) {
        if (v.__op === "serverTime")
          transforms.push({ fieldPath: fp, setToServerValue: "REQUEST_TIME" });
        else if (v.__op === "deleteField") paths.push(fp);
        else if (v.__op === "arrayUnion")
          transforms.push({
            fieldPath: fp,
            appendMissingElements: { values: (v.values ?? []).map(toValue) }
          });
        else if (v.__op === "arrayRemove")
          transforms.push({
            fieldPath: fp,
            removeAllFromArray: { values: (v.values ?? []).map(toValue) }
          });
        continue;
      }
      if (v === void 0) continue;
      const clean = strip(v, here, transforms);
      if (mask && k.includes(".")) {
        let cur = value;
        const parts = k.split(".");
        parts.slice(0, -1).forEach((p) => {
          cur[p] = cur[p] ?? {};
          cur = cur[p];
        });
        cur[parts[parts.length - 1]] = clean;
        paths.push(fp);
      } else if (mask && v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        value[k] = clean;
        paths.push(fp);
      } else {
        value[k] = clean;
        paths.push(fp);
      }
    }
    return { value, transforms, paths };
  }
  function opsToWrites(projectId, ops) {
    const root = `projects/${projectId}/databases/(default)/documents`;
    return ops.map((op) => {
      const name = `${root}/${op.path}`;
      if (op.kind === "delete") return { delete: name };
      if (op.kind === "set") {
        const w2 = walk(op.data, [], false);
        return {
          update: { name, fields: toFields(w2.value) },
          ...w2.transforms.length ? { updateTransforms: w2.transforms } : {}
        };
      }
      const w = walk(op.data, [], true);
      return {
        update: { name, fields: toFields(w.value) },
        updateMask: { fieldPaths: w.paths },
        ...w.transforms.length ? { updateTransforms: w.transforms } : {},
        currentDocument: { exists: true }
      };
    });
  }
  function buildQuery(q) {
    const filters = (q.where ?? []).map((f) => ({
      fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: toValue(f.value) }
    }));
    return {
      from: [{ collectionId: q.collection, ...q.group ? { allDescendants: true } : {} }],
      ...filters.length === 1 ? { where: filters[0] } : filters.length > 1 ? { where: { compositeFilter: { op: "AND", filters } } } : {},
      ...q.orderBy?.length ? {
        orderBy: q.orderBy.map((o) => ({
          field: { fieldPath: o.field },
          direction: o.dir ?? "ASCENDING"
        }))
      } : {},
      ...q.limit ? { limit: q.limit } : {}
    };
  }
  var FirestoreClient = class {
    constructor(p, projectId) {
      this.p = p;
      this.projectId = projectId;
      __publicField(this, "base");
      this.base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    }
    call(url, method, body) {
      const res = this.p.http({
        url,
        method,
        oauth: true,
        ...body !== void 0 ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}
      });
      let json2 = null;
      try {
        json2 = res.body ? JSON.parse(res.body) : null;
      } catch {
      }
      return { status: res.status, json: json2 };
    }
    fail(status, json2, what) {
      const msg = json2?.error?.message ?? `HTTP ${status}`;
      this.p.log(`Firestore ${what} failed: ${status} ${msg}`);
      if (status === 429 || status === 503)
        throw new HelperError("unavailable", "The database is busy. Try again shortly.");
      if (status === 403 || status === 401)
        throw new HelperError(
          "internal",
          "The helper is not allowed to use the database (check the Firestore API and the Cloud project link)."
        );
      if (status === 404) throw new HelperError("not_found", "Not found.");
      throw new HelperError("internal", "The database request failed.");
    }
    getDoc(path) {
      const { status, json: json2 } = this.call(`${this.base}/${path}`, "GET");
      if (status === 404) return null;
      if (status !== 200) this.fail(status, json2, `get ${path}`);
      return decodeDoc(json2);
    }
    /** Several documents in one request; missing ones are simply absent from the result. */
    batchGet(paths) {
      if (paths.length === 0) return [];
      const names = paths.map((x) => `projects/${this.projectId}/databases/(default)/documents/${x}`);
      const { status, json: json2 } = this.call(`${this.base}:batchGet`, "POST", { documents: names });
      if (status !== 200) this.fail(status, json2, "batchGet");
      return json2.flatMap(
        (r) => r.found ? [decodeDoc(r.found)] : []
      );
    }
    query(q) {
      const url = q.parent ? `${this.base}/${q.parent}:runQuery` : `${this.base}:runQuery`;
      const { status, json: json2 } = this.call(url, "POST", { structuredQuery: buildQuery(q) });
      if (status !== 200) this.fail(status, json2, `query ${q.collection}`);
      return json2.flatMap(
        (r) => r.document ? [decodeDoc(r.document)] : []
      );
    }
    /** Atomic, like the app's batches. Max 500 writes per commit (Firestore's limit). */
    commit(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const writes = opsToWrites(this.projectId, ops.slice(i, i + 400));
        const { status, json: json2 } = this.call(`${this.base}:commit`, "POST", { writes });
        if (status !== 200) this.fail(status, json2, "commit");
      }
    }
  };

  // src/router.ts
  var MAX_REQUEST_CHARS = 2e6;
  var actions = {
    ping: {
      auth: "none",
      run: () => ({ pong: true, at: (/* @__PURE__ */ new Date()).toISOString(), version: VERSION })
    },
    whoami: {
      auth: "user",
      run: (ctx, req) => {
        const wid = typeof req["workspaceId"] === "string" ? req["workspaceId"] : null;
        return {
          uid: ctx.caller.uid,
          email: ctx.caller.email,
          role: wid ? roleIn(ctx.db, ctx.caller.uid, wid) : null,
          workspaceId: wid,
          version: VERSION,
          serverTime: (/* @__PURE__ */ new Date()).toISOString(),
          config: { driveFolder: ctx.cfg.driveRootFolderId !== null, timeZone: TIME_ZONE }
        };
      }
    }
  };
  var ok = (data) => ({ ok: true, data });
  var fail = (code, message) => ({
    ok: false,
    error: { code, message }
  });
  function handleRequest(p, raw) {
    try {
      if (typeof raw !== "string" || raw.length === 0)
        throw new HelperError("bad_request", "Empty request.");
      if (raw.length > MAX_REQUEST_CHARS)
        throw new HelperError("too_large", "That request is too large.");
      let req;
      try {
        req = JSON.parse(raw);
      } catch {
        throw new HelperError("bad_request", "The request must be JSON.");
      }
      if (typeof req !== "object" || req === null || Array.isArray(req))
        throw new HelperError("bad_request", "The request must be a JSON object.");
      const body = req;
      const name = body["action"];
      if (typeof name !== "string" || !Object.hasOwn(actions, name))
        throw new HelperError("unknown_action", "Unknown action.");
      const action = actions[name];
      const cfg = loadConfig(p);
      const db = new FirestoreClient(p, cfg.projectId);
      const ctx = { p, cfg, db, caller: null, workspaceId: null, role: null };
      if (action.auth !== "none") {
        ctx.caller = verifyIdToken(p, cfg, body["idToken"]);
        if (action.auth === "member" || action.auth === "admin") {
          const wid = body["workspaceId"];
          ctx.role = roleIn(db, ctx.caller.uid, wid);
          ctx.workspaceId = wid;
          if (action.auth === "admin" && ctx.role !== "admin")
            throw new HelperError("forbidden", "Only a workspace admin can do that.");
          if (action.writes && ctx.role === "viewer")
            throw new HelperError("forbidden", "Viewers can’t make changes.");
        }
      }
      return ok(action.run(ctx, body));
    } catch (e) {
      if (e instanceof HelperError) return fail(e.code, e.message);
      p.log(`Unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return fail("internal", "Something went wrong in the helper.");
    }
  }

  // src/Code.ts
  function json(body) {
    return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
      ContentService.MimeType.JSON
    );
  }
  function doGet() {
    return json({
      ok: true,
      data: { name: "Sorted helper", version: VERSION, at: (/* @__PURE__ */ new Date()).toISOString() }
    });
  }
  function doPost(e) {
    return json(handleRequest(gasPlatform(), e?.postData?.contents));
  }
  function runScheduler() {
    console.log("Scheduler tick (nothing scheduled yet).");
  }
  function runHousekeeping() {
    console.log("Housekeeping tick (nothing to do yet).");
  }
  function runDigest() {
    console.log("Digest tick (nothing to send yet).");
  }
  var HANDLERS = ["runScheduler", "runHousekeeping", "runDigest"];
  function setup() {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty("DRIVE_ROOT_FOLDER_ID"))
      props.setProperty("DRIVE_ROOT_FOLDER_ID", DEFAULT_DRIVE_ROOT);
    for (const t of ScriptApp.getProjectTriggers())
      if (HANDLERS.includes(t.getHandlerFunction()))
        ScriptApp.deleteTrigger(t);
    ScriptApp.newTrigger("runScheduler").timeBased().everyMinutes(10).create();
    ScriptApp.newTrigger("runHousekeeping").timeBased().everyDays(1).atHour(3).inTimezone(TIME_ZONE).create();
    ScriptApp.newTrigger("runDigest").timeBased().everyDays(1).atHour(7).inTimezone(TIME_ZONE).create();
    console.log(
      `Sorted helper ${VERSION} is set up. Triggers: scheduler every 10 min, housekeeping 3am, digest 7am (${TIME_ZONE}).`
    );
  }
  return __toCommonJS(Code_exports);
})();

function doGet(...args) { return Sorted.doGet(...args); }
function doPost(...args) { return Sorted.doPost(...args); }
function setup(...args) { return Sorted.setup(...args); }
function runScheduler(...args) { return Sorted.runScheduler(...args); }
function runHousekeeping(...args) { return Sorted.runHousekeeping(...args); }
function runDigest(...args) { return Sorted.runDigest(...args); }
