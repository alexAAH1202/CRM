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
    runDigest: () => runDigest2,
    runHousekeeping: () => runHousekeeping2,
    runScheduler: () => runScheduler,
    setup: () => setup
  });

  // ../shared/src/constants.ts
  var LIMITS = {
    /** Max boards a single dashboard may combine (protects read quota). */
    MAX_DASHBOARD_BOARDS: 5,
    /** Max upload size for Drive-backed files. */
    MAX_FILE_MB: 10,
    /** Time-tracking sessions kept inline on an item before archiving to a subcollection. */
    MAX_INLINE_TIME_SESSIONS: 200,
    /** Automation run history kept per board. */
    MAX_AUTOMATION_RUNS_PER_BOARD: 50,
    /** Max nested automation depth (loop guard). */
    MAX_AUTOMATION_DEPTH: 3,
    /** Firestore writeBatch hard limit. */
    MAX_BATCH_WRITES: 500,
    /** Daily email budget for Apps Script digests (consumer cap is ~100 recipients). */
    MAX_DIGEST_EMAILS_PER_DAY: 80,
    /** String length caps enforced in rules. */
    MAX_NAME_LENGTH: 200,
    MAX_WORKSPACE_NAME_LENGTH: 80,
    MAX_DISPLAY_NAME_LENGTH: 120,
    MAX_URL_LENGTH: 2048,
    MAX_BOARD_MEMBERS: 50,
    MAX_BOARD_COLUMNS: 100,
    MAX_BOARD_GROUPS: 100,
    MAX_ITEM_NAME_LENGTH: 500,
    MAX_DESCRIPTION_LENGTH: 5e3,
    MAX_EMAIL_LENGTH: 254,
    /** Members per workspace (small-team product; keeps rule arrays bounded). */
    MAX_WORKSPACE_MEMBERS: 50
  };

  // ../shared/src/paths.ts
  var paths = {
    user: (uid) => `users/${uid}`,
    workspaceCreators: () => "appConfig/workspaceCreators",
    workspace: (wid) => `workspaces/${wid}`,
    members: (wid) => `workspaces/${wid}/members`,
    member: (wid, uid) => `workspaces/${wid}/members/${uid}`,
    invites: (wid) => `workspaces/${wid}/invites`,
    invite: (wid, emailLower) => `workspaces/${wid}/invites/${emailLower}`,
    folders: (wid) => `workspaces/${wid}/folders`,
    folder: (wid, fid) => `workspaces/${wid}/folders/${fid}`,
    boards: (wid) => `workspaces/${wid}/boards`,
    board: (wid, bid) => `workspaces/${wid}/boards/${bid}`,
    notifications: (wid, uid) => `workspaces/${wid}/notifications/${uid}/items`,
    notification: (wid, uid, nid) => `workspaces/${wid}/notifications/${uid}/items/${nid}`,
    updates: (wid, bid, iid) => `workspaces/${wid}/boards/${bid}/items/${iid}/updates`,
    update: (wid, bid, iid, uid) => `workspaces/${wid}/boards/${bid}/items/${iid}/updates/${uid}`
  };

  // ../shared/src/ops.ts
  var SERVER_TIME = Object.freeze({ __op: "serverTime" });
  var DELETE_FIELD = Object.freeze({ __op: "deleteField" });

  // ../shared/src/ids.ts
  var ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
  function shortId(len = 8) {
    const bytes = new Uint8Array(len);
    globalThis.crypto.getRandomValues(bytes);
    let out = "";
    for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
    return out;
  }

  // ../shared/src/ordering.ts
  var DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var ZERO = DIGITS[0];
  var SMALLEST_INTEGER = "A" + ZERO.repeat(26);
  function midpoint(a, b) {
    if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
    if (a.slice(-1) === ZERO || b && b.slice(-1) === ZERO) throw new Error("trailing zero");
    if (b) {
      let n = 0;
      while ((a[n] ?? ZERO) === b[n]) n++;
      if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
    const digitA = a ? DIGITS.indexOf(a[0]) : 0;
    const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
    if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))];
    if (b && b.length > 1) return b.slice(0, 1);
    return DIGITS[digitA] + midpoint(a.slice(1), null);
  }
  function integerLength(head) {
    if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
    if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
    throw new Error(`invalid order key head: ${head}`);
  }
  function integerPart(key) {
    const len = integerLength(key[0]);
    if (len > key.length) throw new Error(`invalid order key: ${key}`);
    return key.slice(0, len);
  }
  function validate(key) {
    if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
    const i = integerPart(key);
    if (key.slice(i.length).slice(-1) === ZERO) throw new Error(`invalid order key: ${key}`);
  }
  function incrementInteger(x) {
    const [head, ...digs] = x.split("");
    let carry = true;
    for (let i = digs.length - 1; carry && i >= 0; i--) {
      const d = DIGITS.indexOf(digs[i]) + 1;
      if (d === DIGITS.length) digs[i] = ZERO;
      else {
        digs[i] = DIGITS[d];
        carry = false;
      }
    }
    if (!carry) return head + digs.join("");
    if (head === "Z") return "a" + ZERO;
    if (head === "z") return null;
    const h = String.fromCharCode(head.charCodeAt(0) + 1);
    if (h > "a") digs.push(ZERO);
    else digs.pop();
    return h + digs.join("");
  }
  function decrementInteger(x) {
    const [head, ...digs] = x.split("");
    let borrow = true;
    for (let i = digs.length - 1; borrow && i >= 0; i--) {
      const d = DIGITS.indexOf(digs[i]) - 1;
      if (d === -1) digs[i] = DIGITS.slice(-1);
      else {
        digs[i] = DIGITS[d];
        borrow = false;
      }
    }
    if (!borrow) return head + digs.join("");
    if (head === "a") return "Z" + DIGITS.slice(-1);
    if (head === "A") return null;
    const h = String.fromCharCode(head.charCodeAt(0) - 1);
    if (h < "Z") digs.push(DIGITS.slice(-1));
    else digs.pop();
    return h + digs.join("");
  }
  function keyBetween(a, b) {
    if (a !== null) validate(a);
    if (b !== null) validate(b);
    if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);
    if (a === null) {
      if (b === null) return "a" + ZERO;
      const ib2 = integerPart(b);
      const fb2 = b.slice(ib2.length);
      if (ib2 === SMALLEST_INTEGER) return ib2 + midpoint("", fb2);
      if (ib2 < b) return ib2;
      const res = decrementInteger(ib2);
      if (res === null) throw new Error("cannot decrement any more");
      return res;
    }
    if (b === null) {
      const ia2 = integerPart(a);
      const i2 = incrementInteger(ia2);
      return i2 === null ? ia2 + midpoint(a.slice(ia2.length), null) : i2;
    }
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ia === ib) return ia + midpoint(fa, fb);
    const i = incrementInteger(ia);
    if (i === null) throw new Error("cannot increment any more");
    if (i < b) return i;
    return ia + midpoint(fa, null);
  }

  // ../shared/src/timeTracking.ts
  var MAX_TIME_SESSIONS = 200;
  var ROLLUP_BATCH = 100;
  var MAX_SESSION_MS = 24 * 36e5;
  var MIN_START = Date.UTC(2e3, 0, 1);
  var MAX_NOTE = 200;
  var isSession = (s) => {
    const t = s;
    return !!t && typeof t.id === "string" && t.id.length > 0 && t.id.length <= 64 && typeof t.uid === "string" && t.uid.length > 0 && t.uid.length <= 128 && typeof t.start === "number" && typeof t.end === "number" && Number.isFinite(t.start) && Number.isFinite(t.end) && t.start >= MIN_START && t.end > t.start;
  };
  function normalizeTimeValue(v) {
    const raw = v?.sessions;
    if (!Array.isArray(raw)) return null;
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const s of raw) {
      if (!isSession(s) || seen.has(s.id)) continue;
      if (!s.rolled && s.end - s.start > MAX_SESSION_MS) continue;
      seen.add(s.id);
      const clean = {
        id: s.id,
        uid: s.uid,
        start: Math.trunc(s.start),
        end: Math.trunc(s.end)
      };
      if (typeof s.note === "string" && s.note.trim()) clean.note = s.note.trim().slice(0, MAX_NOTE);
      if (s.rolled === true) clean.rolled = true;
      out.push(clean);
      if (out.length >= MAX_TIME_SESSIONS + ROLLUP_BATCH) break;
    }
    return out.length ? { sessions: out.sort((a, b) => a.start - b.start) } : null;
  }
  var durationOf = (s) => s.end - s.start;
  function totalMs(v) {
    return (v?.sessions ?? []).reduce((n, s) => n + durationOf(s), 0);
  }

  // ../shared/src/dates.ts
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MS_PER_DAY = 864e5;
  function isIsoDate(v) {
    if (typeof v !== "string" || !ISO_RE.test(v)) return false;
    const d = /* @__PURE__ */ new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  function toDayNumber(iso) {
    if (!isIsoDate(iso)) return null;
    return Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);
  }
  function fromDayNumber(n) {
    return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = toDayNumber(iso);
    return d === null ? null : fromDayNumber(d + Math.trunc(n));
  }
  function diffDays(a, b) {
    const x = toDayNumber(a);
    const y = toDayNumber(b);
    return x === null || y === null ? null : x - y;
  }
  function weekdayOf(dayNumber) {
    return ((dayNumber + 4) % 7 + 7) % 7;
  }

  // ../shared/src/columns.ts
  var COLUMN_TYPES = [
    "text",
    "longText",
    "status",
    "dropdown",
    "tags",
    "people",
    "date",
    "timeline",
    "numbers",
    "rating",
    "checkbox",
    "link",
    "email",
    "phone",
    "files",
    "time",
    "dependency",
    "progress",
    "formula",
    "itemId",
    "createdAt",
    "updatedAt",
    "createdBy",
    "group"
  ];
  var COMPUTED_TYPES = [
    "group",
    "formula",
    "progress",
    "itemId",
    "createdAt",
    "updatedAt",
    "createdBy"
  ];
  function isComputedType(type) {
    return COMPUTED_TYPES.includes(type);
  }
  var MAX_FILES = 20;
  var MAX_DEPENDENCIES = 30;
  var MAX_LAG_DAYS = 365;
  var RATING_MAX = 5;
  var COLUMN_META = {
    text: { label: "Text", width: 180, description: "Short text", group: "Text & numbers" },
    longText: {
      label: "Long text",
      width: 220,
      description: "Notes and longer descriptions",
      group: "Text & numbers"
    },
    numbers: {
      label: "Numbers",
      width: 120,
      description: "Amounts, costs, hours",
      group: "Text & numbers"
    },
    rating: { label: "Rating", width: 130, description: "1 to 5 stars", group: "Text & numbers" },
    checkbox: { label: "Checkbox", width: 100, description: "Yes / no", group: "Text & numbers" },
    status: {
      label: "Status",
      width: 150,
      description: "Coloured labels like Done or Stuck",
      group: "Choices & people"
    },
    dropdown: {
      label: "Dropdown",
      width: 170,
      description: "Pick one or more options",
      group: "Choices & people"
    },
    tags: {
      label: "Tags",
      width: 170,
      description: "Tags you can create as you go",
      group: "Choices & people"
    },
    people: {
      label: "People",
      width: 130,
      description: "Assign household members",
      group: "Choices & people"
    },
    date: { label: "Date", width: 130, description: "A single date", group: "Dates" },
    timeline: { label: "Timeline", width: 190, description: "A start and end date", group: "Dates" },
    link: { label: "Link", width: 180, description: "A web address", group: "Links & files" },
    email: { label: "Email", width: 190, description: "An email address", group: "Links & files" },
    phone: { label: "Phone", width: 150, description: "A phone number", group: "Links & files" },
    files: {
      label: "Files",
      width: 170,
      description: "Links to files (e.g. in Google Drive)",
      group: "Links & files"
    },
    formula: {
      label: "Formula",
      width: 160,
      description: "Calculate from other columns",
      group: "Calculated"
    },
    progress: {
      label: "Progress",
      width: 160,
      description: "Percent done, from subitems or checkboxes",
      group: "Calculated"
    },
    itemId: {
      label: "Item ID",
      width: 100,
      description: "An automatic number for each item",
      group: "Calculated"
    },
    createdAt: {
      label: "Created",
      width: 130,
      description: "When the item was created",
      group: "Calculated"
    },
    updatedAt: {
      label: "Last updated",
      width: 130,
      description: "When the item last changed",
      group: "Calculated"
    },
    group: {
      label: "Group",
      width: 150,
      description: "Which group the item is in; change it to move the item",
      group: "Choices & people"
    },
    createdBy: {
      label: "Created by",
      width: 130,
      description: "Who created the item",
      group: "Calculated"
    },
    time: {
      label: "Time tracking",
      width: 150,
      description: "Start a timer or log hours; see totals",
      group: "Calculated"
    },
    dependency: {
      label: "Dependency",
      width: 190,
      description: "Items that must finish first",
      group: "Relations"
    }
  };
  function defaultStatusLabels() {
    return [
      { id: "not_started", name: "Not started", color: "gray" },
      { id: "working", name: "Working on it", color: "orange" },
      { id: "stuck", name: "Stuck", color: "red" },
      { id: "done", name: "Done", color: "green" }
    ];
  }
  function makeColumn(type, title, settings = {}) {
    const base = {
      id: shortId(),
      type,
      title: title ?? COLUMN_META[type].label,
      settings: {}
    };
    switch (type) {
      case "status":
        base.settings = { labels: defaultStatusLabels(), defaultLabelId: null, ...settings };
        break;
      case "dropdown":
      case "tags":
        base.settings = { options: [], ...settings };
        break;
      case "numbers":
        base.settings = { unit: "", unitPosition: "prefix", decimals: 0, ...settings };
        break;
      case "formula":
        base.settings = { formula: "", ...settings };
        break;
      case "progress":
        base.settings = {
          progress: {
            source: "subitems",
            statusColumnId: null,
            doneLabelIds: [],
            checkboxColumnIds: []
          },
          ...settings
        };
        break;
      case "itemId":
        base.settings = { prefix: "#", ...settings };
        break;
      default:
        base.settings = { ...settings };
    }
    return base;
  }
  function normalizeValue(col, v) {
    switch (col.type) {
      case "text":
      case "longText":
        return typeof v === "string" && v.trim() !== "" ? v : null;
      case "status": {
        const labels = col.settings.labels ?? [];
        return typeof v === "string" && labels.some((l) => l.id === v) ? v : null;
      }
      case "dropdown": {
        const ids = new Set((col.settings.options ?? []).map((o) => o.id));
        const arr = Array.isArray(v) ? v.filter((x) => typeof x === "string" && ids.has(x)) : [];
        return arr.length ? arr : null;
      }
      case "people": {
        const arr = Array.isArray(v) ? v.filter((x) => typeof x === "string" && x !== "") : [];
        return arr.length ? [...new Set(arr)] : null;
      }
      case "date":
        return isIsoDate(v) ? v : null;
      case "timeline": {
        const t = v;
        if (!t || !isIsoDate(t.start) || !isIsoDate(t.end)) return null;
        return t.start <= t.end ? { start: t.start, end: t.end } : { start: t.end, end: t.start };
      }
      case "numbers":
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      case "checkbox":
        return v === true ? true : null;
      case "link": {
        const l = v;
        if (!l || typeof l.url !== "string") return null;
        const url = normalizeUrl(l.url);
        return url ? { url, text: typeof l.text === "string" ? l.text : "" } : null;
      }
      case "tags": {
        const ids = new Set((col.settings.options ?? []).map((o) => o.id));
        const arr = Array.isArray(v) ? v.filter((x) => typeof x === "string" && ids.has(x)) : [];
        return arr.length ? [...new Set(arr)] : null;
      }
      case "rating":
        return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= RATING_MAX ? v : null;
      case "email": {
        const t = typeof v === "string" ? v.trim() : "";
        return t.length <= 254 && EMAIL_RE.test(t) ? t : null;
      }
      case "phone": {
        const t = typeof v === "string" ? v.trim() : "";
        return PHONE_RE.test(t) && (t.match(/\d/g)?.length ?? 0) >= 3 ? t : null;
      }
      case "files": {
        if (!Array.isArray(v)) return null;
        const seen = /* @__PURE__ */ new Set();
        const out = [];
        for (const f of v) {
          if (!f || typeof f.url !== "string") continue;
          const url = normalizeUrl(f.url);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          const name = typeof f.name === "string" && f.name.trim() ? f.name.trim().slice(0, 200) : url.replace(/^https?:\/\//, "").slice(0, 200);
          const entry = { name, url };
          if (typeof f.driveFileId === "string" && /^[A-Za-z0-9_-]{5,128}$/.test(f.driveFileId))
            entry.driveFileId = f.driveFileId;
          if (typeof f.mimeType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(f.mimeType) && f.mimeType.length <= 100)
            entry.mimeType = f.mimeType;
          if (typeof f.size === "number" && Number.isInteger(f.size) && f.size >= 0 && f.size <= 1e9)
            entry.size = f.size;
          if (typeof f.addedBy === "string" && f.addedBy.length > 0 && f.addedBy.length <= 128)
            entry.addedBy = f.addedBy;
          if (typeof f.addedAt === "string" && f.addedAt.length > 0 && f.addedAt.length <= 40)
            entry.addedAt = f.addedAt;
          out.push(entry);
          if (out.length >= MAX_FILES) break;
        }
        return out.length ? out : null;
      }
      case "time":
        return normalizeTimeValue(v);
      case "dependency": {
        if (!Array.isArray(v)) return null;
        const seen = /* @__PURE__ */ new Set();
        const out = [];
        for (const d of v) {
          const id = typeof d === "string" ? d : d?.id;
          if (typeof id !== "string" || id === "" || id.length > 128 || seen.has(id)) continue;
          const rawLag = typeof d === "object" && d !== null ? d.lag : 0;
          const lag = typeof rawLag === "number" && Number.isFinite(rawLag) ? Math.max(-MAX_LAG_DAYS, Math.min(MAX_LAG_DAYS, Math.trunc(rawLag))) : 0;
          seen.add(id);
          out.push({ id, lag });
          if (out.length >= MAX_DEPENDENCIES) break;
        }
        return out.length ? out : null;
      }
      // Computed columns: the value is whatever was worked out for display (never stored).
      case "progress":
        return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
      case "itemId":
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      case "createdAt":
      case "updatedAt":
        return isIsoDate(v) ? v : null;
      case "createdBy":
      case "group":
        return typeof v === "string" && v !== "" ? v : null;
      case "formula":
        if (typeof v === "number") return Number.isFinite(v) ? v : null;
        if (typeof v === "boolean") return v;
        return typeof v === "string" && v !== "" ? v : null;
    }
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE_RE = /^[+()\-.\s\d#*xX]{3,30}$/;
  function normalizeUrl(raw) {
    const url = raw.trim();
    if (!url || /^(javascript|data|vbscript):/i.test(url)) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    return `https://${url}`;
  }
  function computeAssignees(columns, values) {
    const out = /* @__PURE__ */ new Set();
    for (const c of columns) {
      if (c.type !== "people") continue;
      const v = normalizeValue(c, values[c.id]);
      if (Array.isArray(v)) v.forEach((u) => out.add(u));
    }
    return [...out].sort();
  }
  function defaultItemValues(columns) {
    const out = {};
    for (const col of columns) {
      if (isComputedType(col.type)) continue;
      const raw = col.type === "status" ? col.settings.defaultLabelId : col.settings.defaultValue;
      if (raw === void 0 || raw === null) continue;
      const v = normalizeValue(col, raw);
      if (v !== null) out[col.id] = v;
    }
    return out;
  }
  var PRIORITY_LABELS = [
    { id: "critical", name: "Critical", color: "red" },
    { id: "high", name: "High", color: "orange" },
    { id: "medium", name: "Medium", color: "yellow" },
    { id: "low", name: "Low", color: "sky" }
  ];
  var COLUMN_PICKER = [
    ...COLUMN_TYPES.map((t) => ({
      key: t,
      label: COLUMN_META[t].label,
      description: COLUMN_META[t].description,
      group: COLUMN_META[t].group,
      make: () => makeColumn(t)
    })),
    {
      key: "priority",
      label: "Priority",
      description: "Critical, High, Medium, Low",
      group: "Choices & people",
      make: () => makeColumn("status", "Priority", {
        labels: PRIORITY_LABELS.map((l) => ({ ...l })),
        defaultLabelId: null
      })
    }
  ];

  // ../shared/src/boardOps.ts
  var boardPaths = {
    view: (wid, bid, vid) => `${paths.board(wid, bid)}/views/${vid}`,
    counter: (wid, bid) => `${paths.board(wid, bid)}/meta/counter`,
    items: (wid, bid) => `${paths.board(wid, bid)}/items`,
    item: (wid, bid, iid) => `${paths.board(wid, bid)}/items/${iid}`,
    activity: (wid, bid) => `${paths.board(wid, bid)}/activity`,
    runs: (wid, bid) => `${paths.board(wid, bid)}/automationRuns`,
    events: (wid, bid) => `${paths.board(wid, bid)}/scheduledEvents`,
    event: (wid, bid, eid) => `${paths.board(wid, bid)}/scheduledEvents/${eid}`,
    automations: (wid, bid) => `${paths.board(wid, bid)}/automations`,
    automation: (wid, bid, aid) => `${paths.board(wid, bid)}/automations/${aid}`,
    activityDoc: (wid, bid, id) => `${paths.board(wid, bid)}/activity/${id}`
  };
  function buildItemDoc(uid, columns, it) {
    const values = cleanValues(columns, it.values ?? {});
    return {
      name: it.name.trim(),
      groupId: it.groupId,
      order: it.order,
      parentId: it.parentId ?? null,
      itemNumber: it.itemNumber,
      values,
      assigneeUids: computeAssignees(columns, values),
      reminderKeys: [],
      archived: false,
      deletedAt: null,
      createdBy: uid,
      createdAt: SERVER_TIME,
      updatedBy: uid,
      updatedAt: SERVER_TIME
    };
  }
  function cleanValues(columns, values) {
    const out = {};
    for (const col of columns) {
      if (isComputedType(col.type)) continue;
      const v = normalizeValue(col, values[col.id]);
      if (v !== null) out[col.id] = v;
    }
    return out;
  }

  // ../shared/src/viewConfig.ts
  var DEFAULT_CAPACITY_HOURS = 40;
  var MAX_CAPACITY_HOURS = 168;
  var NAME_COLUMN_ID = "name";
  var MIN_COL_WIDTH = 80;
  var MAX_COL_WIDTH = 600;
  var MAX_FILTERS = 12;
  function parseViewConfig(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const filters = (Array.isArray(r["filters"]) ? r["filters"] : []).filter(
      (f) => !!f && typeof f === "object" && typeof f.columnId === "string"
    ).slice(0, MAX_FILTERS);
    const sort = (Array.isArray(r["sort"]) ? r["sort"] : []).filter(
      (x) => !!x && typeof x === "object" && typeof x.columnId === "string"
    ).map((x) => ({
      columnId: x.columnId,
      dir: x.dir === "desc" ? "desc" : "asc"
    })).slice(0, 3);
    const widths = {};
    if (r["colWidths"] && typeof r["colWidths"] === "object") {
      for (const [k, v] of Object.entries(r["colWidths"])) {
        if (typeof v === "number" && Number.isFinite(v)) widths[k] = clampWidth(v);
      }
    }
    return {
      filters,
      sort,
      groupBy: typeof r["groupBy"] === "string" ? r["groupBy"] : null,
      hiddenCols: Array.isArray(r["hiddenCols"]) ? r["hiddenCols"].filter((x) => typeof x === "string") : [],
      colWidths: widths,
      showArchived: r["showArchived"] === true,
      options: parseViewOptions(r["options"])
    };
  }
  var MAX_ORDERED_LANES = 40;
  var MAX_ORDERED_CARDS = 300;
  function parseCardOrder(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [lane, ids] of Object.entries(raw)) {
      if (Object.keys(out).length >= MAX_ORDERED_LANES) break;
      if (lane.length === 0 || lane.length > 64 || !Array.isArray(ids)) continue;
      const seen = /* @__PURE__ */ new Set();
      for (const id of ids) {
        if (typeof id === "string" && id.length > 0 && id.length <= 64 && !seen.has(id)) seen.add(id);
        if (seen.size >= MAX_ORDERED_CARDS) break;
      }
      if (seen.size > 0) out[lane] = [...seen];
    }
    return out;
  }
  function parseViewOptions(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const str2 = (v) => typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
    const hours = (v, fallback) => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= MAX_CAPACITY_HOURS ? v : fallback;
    const byUid = {};
    if (r["capacityByUid"] && typeof r["capacityByUid"] === "object") {
      for (const [k, v] of Object.entries(r["capacityByUid"])) {
        if (k.length <= 64 && Object.keys(byUid).length < 50)
          byUid[k] = hours(v, DEFAULT_CAPACITY_HOURS);
      }
    }
    const oneOf = (v, all, d) => all.includes(v) ? v : d;
    return {
      laneColumnId: str2(r["laneColumnId"]),
      cardOrder: parseCardOrder(r["cardOrder"]),
      dateColumnId: str2(r["dateColumnId"]),
      calendarMode: r["calendarMode"] === "week" ? "week" : "month",
      ganttColumnId: str2(r["ganttColumnId"]),
      zoom: oneOf(r["zoom"], ["day", "week", "month"], "week"),
      effortColumnId: str2(r["effortColumnId"]),
      peopleColumnId: str2(r["peopleColumnId"]),
      capacity: hours(r["capacity"], DEFAULT_CAPACITY_HOURS),
      capacityByUid: byUid,
      chartType: oneOf(r["chartType"], ["bar", "stacked", "pie", "line"], "bar"),
      groupColumnId: str2(r["groupColumnId"]),
      stackColumnId: str2(r["stackColumnId"]),
      measure: oneOf(r["measure"], ["count", "sum", "avg"], "count"),
      valueColumnId: str2(r["valueColumnId"])
    };
  }
  function clampWidth(w) {
    return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(w)));
  }
  var ME = "me";
  function isEmptyValue(v) {
    return v === null || v === void 0;
  }
  function filterValueDate(f) {
    return typeof f.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? f.value : null;
  }
  function matchesFilter(item, columns, f, ctx) {
    if (f.columnId === NAME_COLUMN_ID) return matchText(item.name, f);
    const col = columns.find((c) => c.id === f.columnId);
    if (!col) return true;
    const v = normalizeValue(col, item.values[col.id]);
    const empty = isEmptyValue(v);
    if (f.op === "isEmpty") return empty;
    if (f.op === "notEmpty") return !empty;
    switch (col.type) {
      case "text":
      case "longText":
      case "group":
        return matchText(typeof v === "string" ? v : "", f);
      case "link":
        return matchText(v ? v.text || v.url : "", f);
      case "status": {
        const want = Array.isArray(f.value) ? f.value : [];
        const has = typeof v === "string" && want.includes(v);
        return f.op === "noneOf" ? !has : has;
      }
      case "dropdown":
      case "tags":
      case "people":
      case "createdBy": {
        const want = (Array.isArray(f.value) ? f.value : []).map((x) => x === ME ? ctx.me : x);
        const have = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
        const any = have.some((x) => want.includes(x));
        return f.op === "noneOf" ? !any : any;
      }
      case "email":
      case "phone":
        return matchText(typeof v === "string" ? v : "", f);
      case "files":
        return matchText((v ?? []).map((x) => x.name).join(" "), f);
      case "dependency":
        return true;
      case "time": {
        const n = typeof f.value === "number" ? f.value : Number(f.value);
        if (!v || Number.isNaN(n)) return false;
        const hours = totalMs(v) / 36e5;
        return f.op === "eq" ? Math.abs(hours - n) < 5e-3 : f.op === "gt" ? hours > n : hours < n;
      }
      case "rating":
      case "progress":
      case "itemId": {
        const n = typeof f.value === "number" ? f.value : Number(f.value);
        if (typeof v !== "number" || Number.isNaN(n)) return false;
        return f.op === "eq" ? v === n : f.op === "gt" ? v > n : v < n;
      }
      case "formula": {
        if (f.op === "eq" || f.op === "gt" || f.op === "lt") {
          const n = typeof f.value === "number" ? f.value : Number(f.value);
          if (typeof v !== "number" || Number.isNaN(n)) return false;
          return f.op === "eq" ? v === n : f.op === "gt" ? v > n : v < n;
        }
        return matchText(
          typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "",
          f
        );
      }
      case "createdAt":
      case "updatedAt": {
        const d = filterValueDate(f);
        if (!d || typeof v !== "string") return false;
        return f.op === "on" ? v === d : f.op === "before" ? v < d : v > d;
      }
      case "date": {
        if (f.op === "overdue") return typeof v === "string" && v < ctx.today;
        const d = filterValueDate(f);
        if (!d || typeof v !== "string") return false;
        return f.op === "on" ? v === d : f.op === "before" ? v < d : v > d;
      }
      case "timeline": {
        const t = v;
        if (!t) return false;
        if (f.op === "overdue") return t.end < ctx.today;
        const d = filterValueDate(f);
        return !!d && t.start <= d && d <= t.end;
      }
      case "numbers": {
        const n = typeof f.value === "number" ? f.value : Number(f.value);
        if (typeof v !== "number" || Number.isNaN(n)) return false;
        return f.op === "eq" ? v === n : f.op === "gt" ? v > n : v < n;
      }
      case "checkbox":
        return f.op === "checked" ? v === true : v !== true;
    }
  }
  function matchText(text, f) {
    const hay = text.toLowerCase();
    const needle = (typeof f.value === "string" ? f.value : "").toLowerCase();
    switch (f.op) {
      case "contains":
        return hay.includes(needle);
      case "notContains":
        return !hay.includes(needle);
      case "is":
        return hay === needle;
      case "isEmpty":
        return hay === "";
      case "notEmpty":
        return hay !== "";
      default:
        return true;
    }
  }

  // ../shared/src/views.ts
  function spanOf(column, raw) {
    if (column.type === "date") {
      return typeof raw === "string" && toDayNumber(raw) !== null ? { start: raw, end: raw } : null;
    }
    if (column.type === "timeline") {
      const t = raw;
      if (t && typeof t.start === "string" && typeof t.end === "string") {
        const a = toDayNumber(t.start);
        const b = toDayNumber(t.end);
        if (a !== null && b !== null) return a <= b ? { start: t.start, end: t.end } : null;
      }
    }
    return null;
  }

  // ../shared/src/updates.ts
  function itemLink(wid, bid, iid) {
    return `/w/${wid}/b/${bid}?item=${iid}`;
  }
  function notificationOp(n) {
    return {
      kind: "set",
      path: paths.notification(n.wid, n.recipient, n.nid),
      data: {
        type: n.type,
        title: n.title.slice(0, 200),
        body: n.body.slice(0, 1e3),
        link: n.link.slice(0, 500),
        actor: n.actor,
        read: false,
        createdAt: SERVER_TIME
      }
    };
  }

  // ../shared/src/activity.ts
  var clip = (s, n = 200) => s === void 0 ? void 0 : s.slice(0, n);
  function planActivity(i) {
    const d = i.data ?? {};
    const data = {};
    for (const k of ["column", "from", "to", "group", "text"]) {
      const v = clip(d[k]);
      if (v !== void 0) data[k] = v;
    }
    if (typeof d.count === "number") data["count"] = Math.trunc(d.count);
    return {
      kind: "set",
      path: boardPaths.activityDoc(i.wid, i.bid, i.id),
      data: {
        type: i.type,
        itemId: i.itemId,
        itemName: i.itemName.slice(0, 200),
        actor: i.actor,
        data,
        at: SERVER_TIME
      }
    };
  }

  // ../shared/src/myWork.ts
  function dueDateOf(columns, values) {
    const dates = columns.filter((c) => c.type === "date");
    const col = dates.find((c) => /\bdue\b|deadline/i.test(c.title)) ?? dates[0];
    if (col) {
      const s = spanOf(col, values[col.id]);
      if (s) return s.start;
    }
    const tl = columns.find((c) => c.type === "timeline");
    if (tl) return spanOf(tl, values[tl.id])?.end ?? null;
    return null;
  }
  var DONE = /^(done|complete|completed|finished|paid|closed|resolved)$/i;
  function isDone(columns, values) {
    for (const c of columns) {
      if (c.type !== "status") continue;
      const id = values[c.id];
      const label = (c.settings.labels ?? []).find((l) => l.id === id);
      if (label && DONE.test(label.name.trim())) return true;
    }
    return false;
  }
  function bucketOf(due, today) {
    if (!due) return "none";
    const d = toDayNumber(due);
    const t = toDayNumber(today);
    if (d === null || t === null) return "none";
    if (d < t) return "overdue";
    if (d === t) return "today";
    return d - t <= 7 ? "week" : "later";
  }

  // ../shared/src/scheduling.ts
  var DEFAULT_TIMEZONE = "Australia/Melbourne";
  var dtfCache = /* @__PURE__ */ new Map();
  function formatter(tz) {
    let f = dtfCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      dtfCache.set(tz, f);
    }
    return f;
  }
  function wallClock(utcMs, tz) {
    const parts = formatter(tz).formatToParts(new Date(utcMs));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    return {
      y: get("year"),
      mo: get("month"),
      d: get("day"),
      h: get("hour"),
      mi: get("minute"),
      s: get("second")
    };
  }
  function offsetMs(utcMs, tz) {
    const w = wallClock(utcMs, tz);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(utcMs / 1e3) * 1e3;
  }
  function isValidTime(hhmm) {
    return typeof hhmm === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm);
  }
  function zonedToUtcMs(dateIso, hhmm, tz) {
    const day = toDayNumber(dateIso);
    if (day === null || !isValidTime(hhmm)) return null;
    const [h, m] = hhmm.split(":").map(Number);
    const guess = day * 864e5 + (h * 60 + m) * 6e4;
    let utc = guess - offsetMs(guess, tz);
    const again = offsetMs(utc, tz);
    if (again !== offsetMs(guess, tz)) utc = guess - again;
    return utc;
  }
  function localDateIn(utcMs, tz) {
    const w = wallClock(utcMs, tz);
    return `${String(w.y).padStart(4, "0")}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
  }
  var MAX_EVERY = 52;
  function parseRecurrence(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const every = typeof r["every"] === "number" && Number.isInteger(r["every"]) && r["every"] >= 1 && r["every"] <= MAX_EVERY ? r["every"] : 1;
    if (r["kind"] === "daily") return { kind: "daily", every };
    if (r["kind"] === "weekly") {
      const days = (Array.isArray(r["weekdays"]) ? r["weekdays"] : []).filter(
        (d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
      );
      const weekdays = [...new Set(days)].sort((a, b) => a - b);
      return weekdays.length ? { kind: "weekly", every, weekdays } : null;
    }
    if (r["kind"] === "monthly") {
      const d = r["dayOfMonth"];
      return typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 31 ? { kind: "monthly", every, dayOfMonth: d } : null;
    }
    return null;
  }
  var daysInMonth = (y, m1) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
  function matches(rec, dateIso, startIso) {
    const diff = diffDays(dateIso, startIso);
    if (diff === null || diff < 0) return false;
    if (rec.kind === "daily") return diff % rec.every === 0;
    const dn = toDayNumber(dateIso);
    const sn = toDayNumber(startIso);
    if (rec.kind === "weekly") {
      if (!rec.weekdays.includes(weekdayOf(dn))) return false;
      const mondayOf = (n) => n - (weekdayOf(n) + 6) % 7;
      return Math.floor((mondayOf(dn) - mondayOf(sn)) / 7) % rec.every === 0;
    }
    const y = Number(dateIso.slice(0, 4));
    const m = Number(dateIso.slice(5, 7));
    const ys = Number(startIso.slice(0, 4));
    const ms = Number(startIso.slice(5, 7));
    const months = (y - ys) * 12 + (m - ms);
    if (months < 0 || months % rec.every !== 0) return false;
    return Number(dateIso.slice(8, 10)) === Math.min(rec.dayOfMonth, daysInMonth(y, m));
  }
  function nextOccurrence(s, afterMs, tz) {
    if (toDayNumber(s.startDate) === null || !isValidTime(s.atTime)) return null;
    const today = toDayNumber(localDateIn(afterMs, tz));
    for (let n = Math.max(today - 1, toDayNumber(s.startDate)); n < today + 800; n++) {
      const date = fromDayNumber(n);
      if (!matches(s.recurrence, date, s.startDate)) continue;
      const at = zonedToUtcMs(date, s.atTime, tz);
      if (at !== null && at > afterMs) return at;
    }
    return null;
  }
  function fireAtForDate(dateIso, offsetDays, atTime, tz) {
    const d = addDays(dateIso, offsetDays);
    return d === null ? null : zonedToUtcMs(d, atTime, tz);
  }
  var PAST_GRACE_MS = 6 * 3600 * 1e3;
  var MAX_OFFSET_DAYS = 365;

  // ../shared/src/automations.ts
  var MAX_ACTIONS = 5;
  var MAX_CONDITIONS = 5;
  var MAX_DEPTH = 3;
  var MAX_CREATED = 10;
  var MAX_NOTIFY = 10;
  function isScheduledTrigger(t) {
    return t.type === "dateArrives" || t.type === "overdue" || t.type === "recurring";
  }
  function isScheduledAutomation(a) {
    return isScheduledTrigger(a.trigger);
  }
  var TOKEN_ME = "@me";
  function resolveDateToken(v, today) {
    if (typeof v !== "string") return null;
    const m = /^@today(?:([+-])(\d{1,4}))?$/.exec(v);
    if (!m) return null;
    if (!m[1]) return today;
    const n = Number(m[2]);
    return addDays(today, m[1] === "-" ? -n : n);
  }
  function isDateToken(v) {
    return typeof v === "string" && /^@today(?:[+-]\d{1,4})?$/.test(v);
  }
  var str = (v, max = 200) => typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
  function parseTrigger(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    switch (r["type"]) {
      case "itemCreated":
        return { type: "itemCreated" };
      case "columnChanged":
        return { type: "columnChanged", columnId: str(r["columnId"], 64) };
      case "statusChangedTo": {
        const columnId = str(r["columnId"], 64);
        const labelId = str(r["labelId"], 64);
        return columnId && labelId ? { type: "statusChangedTo", columnId, labelId } : null;
      }
      case "personAssigned":
        return { type: "personAssigned", columnId: str(r["columnId"], 64), uid: str(r["uid"], 128) };
      case "movedToGroup": {
        const groupId = str(r["groupId"], 64);
        return groupId ? { type: "movedToGroup", groupId } : null;
      }
      case "subitemsAllDone": {
        const columnId = str(r["columnId"], 64);
        const labelId = str(r["labelId"], 64);
        return columnId && labelId ? { type: "subitemsAllDone", columnId, labelId } : null;
      }
      case "dateArrives": {
        const columnId = str(r["columnId"], 64);
        const off = r["offsetDays"];
        if (!columnId || typeof off !== "number" || !Number.isInteger(off) || Math.abs(off) > MAX_OFFSET_DAYS)
          return null;
        return {
          type: "dateArrives",
          columnId,
          which: r["which"] === "start" ? "start" : "end",
          offsetDays: off,
          atTime: isValidTime(r["atTime"]) ? r["atTime"] : "09:00"
        };
      }
      case "overdue": {
        const columnId = str(r["columnId"], 64);
        return columnId ? { type: "overdue", columnId, atTime: isValidTime(r["atTime"]) ? r["atTime"] : "09:00" } : null;
      }
      case "recurring": {
        const sch = r["schedule"] && typeof r["schedule"] === "object" ? r["schedule"] : {};
        const recurrence = parseRecurrence(sch["recurrence"]);
        if (!recurrence || !isIsoDate(sch["startDate"])) return null;
        return {
          type: "recurring",
          scope: r["scope"] === "items" ? "items" : "board",
          schedule: {
            recurrence,
            atTime: isValidTime(sch["atTime"]) ? sch["atTime"] : "09:00",
            startDate: sch["startDate"]
          }
        };
      }
      default:
        return null;
    }
  }
  function parseAction(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    switch (r["type"]) {
      case "setValue": {
        const columnId = str(r["columnId"], 64);
        return columnId ? { type: "setValue", columnId, value: r["value"] ?? null } : null;
      }
      case "moveToGroup": {
        const groupId = str(r["groupId"], 64);
        return groupId ? { type: "moveToGroup", groupId } : null;
      }
      case "createItem": {
        const name = str(r["name"], 200);
        return name ? {
          type: "createItem",
          name,
          groupId: str(r["groupId"], 64),
          subitem: r["subitem"] === true
        } : null;
      }
      case "duplicate":
        return { type: "duplicate" };
      case "archive":
        return { type: "archive" };
      case "notify": {
        const to = ["assignees", "owner", "actor", "person"].find((x) => x === r["to"]);
        const message = str(r["message"], 200);
        if (!to || !message) return null;
        const uid = str(r["uid"], 128);
        if (to === "person" && !uid) return null;
        return { type: "notify", to, uid: to === "person" ? uid : null, message };
      }
      default:
        return null;
    }
  }
  function parseAutomation(id, raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const trigger = parseTrigger(r["trigger"]);
    if (!trigger) return null;
    const actions2 = (Array.isArray(r["actions"]) ? r["actions"] : []).map(parseAction).filter((a) => a !== null).slice(0, MAX_ACTIONS);
    if (actions2.length === 0) return null;
    const conditions = parseViewConfig({
      filters: Array.isArray(r["conditions"]) ? r["conditions"] : []
    }).filters.slice(0, MAX_CONDITIONS);
    return {
      id,
      name: typeof r["name"] === "string" && r["name"] ? r["name"].slice(0, 120) : "Automation",
      enabled: r["enabled"] === true,
      ownerUid: typeof r["ownerUid"] === "string" ? r["ownerUid"] : "",
      trigger,
      conditions,
      actions: actions2
    };
  }
  function scheduledActionProblem(a) {
    const t = a.trigger;
    if (t.type !== "recurring" || t.scope !== "board") return null;
    for (const act of a.actions) {
      if (act.type === "createItem" && !act.subitem) continue;
      if (act.type === "notify" && act.to !== "assignees") continue;
      return "A list-wide schedule has no single item, so it can only create items and send notifications. Choose “for each matching item” to change items.";
    }
    return null;
  }

  // ../shared/src/automationEngine.ts
  var BOARD_TARGET = "";
  var same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  function addedPeople(before, after) {
    const had = new Set(Array.isArray(before) ? before : []);
    return (Array.isArray(after) ? after : []).filter((u) => !had.has(u));
  }
  function runAutomations(input) {
    const maxDepth = input.maxDepth ?? MAX_DEPTH;
    const { columns, groups, actor } = input;
    const working = /* @__PURE__ */ new Map();
    for (const [id, it] of input.items) working.set(id, it);
    const cloned = /* @__PURE__ */ new Set();
    const patches = /* @__PURE__ */ new Map();
    const createdIds = [];
    const notifyOps = [];
    const runs = [];
    const skippedOnce = /* @__PURE__ */ new Set();
    let counter = input.startNumber;
    if (input.event.kind === "scheduled" && input.event.itemId === null) {
      working.set(BOARD_TARGET, {
        id: BOARD_TARGET,
        name: "",
        groupId: groups[0]?.id ?? "",
        order: "a0",
        parentId: null,
        itemNumber: 0,
        values: {},
        archived: false,
        deleted: false
      });
    }
    const editable = (id) => {
      const it = working.get(id);
      if (!cloned.has(id)) {
        working.set(id, { ...it, values: { ...it.values } });
        cloned.add(id);
      }
      return working.get(id);
    };
    const patchOf = (id) => {
      let p = patches.get(id);
      if (!p) {
        p = { values: {}, peopleTouched: false };
        patches.set(id, p);
      }
      return p;
    };
    const col = (id) => columns.find((c) => c.id === id);
    const live = (it) => !it.deleted;
    const maxOrder = (pred) => {
      let m = null;
      for (const it of working.values())
        if (live(it) && pred(it) && (m === null || it.order > m)) m = it.order;
      return m;
    };
    const targetOf = (a, ev) => {
      const t = a.trigger;
      if (ev.kind === "scheduled") {
        return isScheduledAutomation(a) && ev.automationId === a.id ? ev.itemId ?? BOARD_TARGET : null;
      }
      switch (t.type) {
        case "itemCreated":
          return ev.kind === "created" ? ev.itemId : null;
        case "columnChanged":
          return ev.kind === "cell" && (t.columnId === null || ev.columnId === t.columnId) ? ev.itemId : null;
        case "statusChangedTo": {
          if (ev.kind !== "cell" || ev.columnId !== t.columnId) return null;
          const c = col(t.columnId);
          if (!c || c.type !== "status") return null;
          return normalizeValue(c, ev.after) === t.labelId && !same(ev.before, ev.after) ? ev.itemId : null;
        }
        case "personAssigned": {
          if (ev.kind !== "cell") return null;
          const c = col(ev.columnId);
          if (!c || c.type !== "people") return null;
          if (t.columnId !== null && ev.columnId !== t.columnId) return null;
          const added = addedPeople(ev.before, ev.after);
          return added.length > 0 && (t.uid === null || added.includes(t.uid)) ? ev.itemId : null;
        }
        case "movedToGroup":
          return ev.kind === "moved" && ev.toGroupId === t.groupId ? ev.itemId : null;
        case "dateArrives":
        case "overdue":
        case "recurring":
          return null;
        // these only fire from the clock (handled above)
        case "subitemsAllDone": {
          if (ev.kind !== "cell" || ev.columnId !== t.columnId) return null;
          const sub = working.get(ev.itemId);
          const c = col(t.columnId);
          if (!sub || !sub.parentId || !c || c.type !== "status") return null;
          if (normalizeValue(c, ev.after) !== t.labelId) return null;
          const siblings = [...working.values()].filter(
            (x) => x.parentId === sub.parentId && live(x) && !x.archived
          );
          const done = siblings.length > 0 && siblings.every((x) => normalizeValue(c, x.values[c.id]) === t.labelId);
          return done ? sub.parentId : null;
        }
      }
    };
    const problem = (a, target) => {
      const sched = scheduledActionProblem(a);
      if (sched) return sched;
      let creates = 0;
      for (const act of a.actions) {
        switch (act.type) {
          case "setValue": {
            const c = col(act.columnId);
            if (!c) return "A column it sets was deleted.";
            if (isComputedType(c.type)) return `${c.title} is calculated, so it can’t be set.`;
            if (act.value === TOKEN_ME && c.type !== "people")
              return `“The person who made the change” only fits a People column.`;
            if (isDateToken(act.value) && c.type !== "date")
              return `“Today” only fits a Date column.`;
            break;
          }
          case "moveToGroup":
            if (!groups.some((g) => g.id === act.groupId))
              return "The group it moves to was deleted.";
            if (target.parentId) return "Subitems can’t be moved to another group.";
            break;
          case "createItem":
            creates++;
            if (act.subitem && target.parentId) return "A subitem can’t have subitems.";
            if (act.groupId && !groups.some((g) => g.id === act.groupId))
              return "The group for the new item was deleted.";
            break;
          case "duplicate":
            creates++;
            break;
          default:
            break;
        }
      }
      if (creates > 0) {
        if (counter === null) return "Creating items needs a connection to number them.";
        if (createdIds.length + creates > MAX_CREATED)
          return `Automations can create at most ${MAX_CREATED} items per change.`;
      }
      return null;
    };
    const queue = [{ event: input.event, depth: 0, chain: [] }];
    const emit = (event, q, automationId) => queue.push({ event, depth: q.depth + 1, chain: [...q.chain, automationId] });
    const apply = (a, act, targetId, q) => {
      const target = editable(targetId);
      switch (act.type) {
        case "setValue": {
          const c = col(act.columnId);
          const raw = act.value === TOKEN_ME ? [actor] : isDateToken(act.value) ? resolveDateToken(act.value, input.today) : act.value;
          const next = normalizeValue(c, raw);
          const before = normalizeValue(c, target.values[c.id]);
          if (same(before, next)) return;
          if (next === null) delete target.values[c.id];
          else target.values[c.id] = next;
          patchOf(targetId).values[c.id] = next === null ? DELETE_FIELD : next;
          if (c.type === "people") {
            patchOf(targetId).peopleTouched = true;
            target.assigneeUids = computeAssignees(columns, target.values);
          }
          emit({ kind: "cell", itemId: targetId, columnId: c.id, before, after: next }, q, a.id);
          return;
        }
        case "moveToGroup": {
          if (target.groupId === act.groupId) return;
          const from = target.groupId;
          const order = keyBetween(
            maxOrder((x) => !x.parentId && x.groupId === act.groupId),
            null
          );
          target.groupId = act.groupId;
          target.order = order;
          const p = patchOf(targetId);
          p.groupId = act.groupId;
          p.order = order;
          for (const child of [...working.values()]) {
            if (child.parentId === targetId && child.groupId !== act.groupId) {
              editable(child.id).groupId = act.groupId;
              patchOf(child.id).groupId = act.groupId;
            }
          }
          emit(
            { kind: "moved", itemId: targetId, fromGroupId: from, toGroupId: act.groupId },
            q,
            a.id
          );
          return;
        }
        case "createItem":
        case "duplicate": {
          const isDup = act.type === "duplicate";
          const parentId = isDup ? target.parentId : act.subitem ? targetId : null;
          const groupId = isDup ? target.groupId : act.groupId ?? target.groupId;
          const name = isDup ? `${target.name} (copy)` : act.name.replaceAll("{item}", target.name).slice(0, 500);
          const values = isDup ? { ...target.values } : { ...defaultItemValues(columns) };
          const id = input.newId("item");
          const order = keyBetween(
            maxOrder(
              (x) => parentId ? x.parentId === parentId : !x.parentId && x.groupId === groupId
            ),
            null
          );
          const itemNumber = counter;
          counter = itemNumber + 1;
          working.set(id, {
            id,
            name,
            groupId,
            order,
            parentId,
            itemNumber,
            values,
            archived: false,
            deleted: false,
            assigneeUids: computeAssignees(columns, values)
          });
          cloned.add(id);
          createdIds.push(id);
          emit({ kind: "created", itemId: id }, q, a.id);
          return;
        }
        case "archive": {
          if (target.archived) return;
          target.archived = true;
          patchOf(targetId).archived = true;
          for (const child of [...working.values()]) {
            if (child.parentId === targetId && !child.archived) {
              editable(child.id).archived = true;
              patchOf(child.id).archived = true;
            }
          }
          return;
        }
        case "notify": {
          const who = act.to === "assignees" ? computeAssignees(columns, target.values) : act.to === "owner" ? [a.ownerUid] : act.to === "actor" ? [actor] : [act.uid ?? ""];
          const ids = [...new Set(who)].filter((u) => u && input.memberUids.has(u)).slice(0, MAX_NOTIFY);
          for (const r of ids)
            notifyOps.push(
              notificationOp({
                wid: input.wid,
                recipient: r,
                nid: input.newId("notification"),
                actor,
                type: "automation",
                title: act.message.replaceAll("{item}", targetId === BOARD_TARGET ? "" : target.name || "an item").trim(),
                body: `${input.boardName} · ${a.name}`,
                link: targetId === BOARD_TARGET ? `/w/${input.wid}/b/${input.bid}` : itemLink(input.wid, input.bid, targetId)
              })
            );
          return;
        }
      }
    };
    const ctx = { today: input.today, me: actor, memberName: input.memberName };
    while (queue.length > 0) {
      const q = queue.shift();
      for (const a of input.automations) {
        if (!a.enabled) continue;
        const targetId = targetOf(a, q.event);
        if (targetId === null) continue;
        const target = working.get(targetId);
        if (!target || !live(target)) continue;
        if (targetId !== BOARD_TARGET && !a.conditions.every((f) => matchesFilter(target, columns, f, ctx)))
          continue;
        const guard = q.chain.includes(a.id) ? "Skipped: it would run itself again (loop guard)." : q.depth >= maxDepth ? `Skipped: automations triggering automations stop after ${maxDepth} levels.` : null;
        if (guard) {
          const k = `${a.id}|${guard}`;
          if (!skippedOnce.has(k)) {
            skippedOnce.add(k);
            runs.push({
              automationId: a.id,
              name: a.name,
              status: "skipped",
              error: guard,
              itemId: targetId,
              depth: q.depth
            });
          }
          continue;
        }
        const bad = problem(a, target);
        if (bad) {
          runs.push({
            automationId: a.id,
            name: a.name,
            status: "failed",
            error: bad,
            itemId: targetId,
            depth: q.depth
          });
          continue;
        }
        for (const act of a.actions) apply(a, act, targetId, q);
        runs.push({
          automationId: a.id,
          name: a.name,
          status: "ok",
          itemId: targetId,
          depth: q.depth
        });
      }
    }
    const ops = [];
    const stamp = { updatedBy: actor, updatedAt: SERVER_TIME };
    for (const [id, p] of patches) {
      if (createdIds.includes(id)) continue;
      const data = { ...stamp };
      for (const [cid, v] of Object.entries(p.values)) data[`values.${cid}`] = v;
      const w = working.get(id);
      if (p.peopleTouched) data["assigneeUids"] = computeAssignees(columns, w.values);
      if (p.groupId !== void 0) data["groupId"] = p.groupId;
      if (p.order !== void 0) data["order"] = p.order;
      if (p.archived !== void 0) data["archived"] = p.archived;
      ops.push({ kind: "update", path: boardPaths.item(input.wid, input.bid, id), data });
    }
    for (const id of createdIds) {
      const w = working.get(id);
      ops.push({
        kind: "set",
        path: boardPaths.item(input.wid, input.bid, id),
        data: buildItemDoc(actor, columns, {
          name: w.name,
          groupId: w.groupId,
          order: w.order,
          itemNumber: w.itemNumber,
          parentId: w.parentId,
          values: w.values
        })
      });
    }
    ops.push(...notifyOps);
    for (const r of runs) {
      ops.push({
        kind: "set",
        path: `${boardPaths.runs(input.wid, input.bid)}/${input.newId("run")}`,
        data: {
          automationId: r.automationId,
          name: r.name.slice(0, 120),
          status: r.status,
          ...r.error ? { error: r.error.slice(0, 300) } : {},
          itemId: r.itemId,
          depth: r.depth,
          actor,
          at: SERVER_TIME
        }
      });
    }
    return {
      ops,
      runs,
      created: createdIds.length,
      counterNext: createdIds.length > 0 ? counter : null,
      items: working
    };
  }

  // ../shared/src/files.ts
  var MAX_FILE_BYTES = LIMITS.MAX_FILE_MB * 1024 * 1024;
  var UPLOAD_CHUNK_BYTES = 1024 * 1024;
  var BLOCKED_EXTENSIONS = /* @__PURE__ */ new Set([
    "exe",
    "msi",
    "bat",
    "cmd",
    "com",
    "scr",
    "pif",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "ps1",
    "jar",
    "apk",
    "dmg",
    "app",
    "sh",
    "reg",
    "lnk",
    "dll",
    "hta"
  ]);
  function sanitizeFileName(raw) {
    let s = typeof raw === "string" ? raw : "";
    s = s.replace(/[\u0000-\u001f\u007f<>:"|?*\\/]+/g, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/^[.\s]+/, "");
    if (s.length > 150) {
      const dot = s.lastIndexOf(".");
      const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : "";
      s = s.slice(0, 150 - ext.length).trimEnd() + ext;
    }
    return s || "file";
  }
  function isBlockedFileName(name) {
    const dot = name.lastIndexOf(".");
    return dot >= 0 && BLOCKED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
  }
  function uploadProblem(name, size) {
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0)
      return "That file’s size isn’t valid.";
    if (size === 0) return "That file is empty.";
    if (size > MAX_FILE_BYTES) return `Files can be up to ${LIMITS.MAX_FILE_MB} MB.`;
    if (isBlockedFileName(sanitizeFileName(name)))
      return "That type of file can’t be uploaded (it could run programs).";
    return null;
  }
  function cleanMimeType(raw) {
    return typeof raw === "string" && raw.length <= 100 && /^[\w.+-]+\/[\w.+-]+$/.test(raw) ? raw : "application/octet-stream";
  }
  function driveViewUrl(fileId) {
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  }
  var GOOGLE_DOC = "application/vnd.google-apps.document";
  function googleDocUrl(fileId) {
    return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
  }

  // ../shared/src/helperProtocol.ts
  var HelperError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code");
      this.name = "HelperError";
      this.code = code;
    }
  };
  var HELPER_VERSION = "7e.1";

  // ../shared/src/scheduleOps.ts
  function eventId(automationId, itemId) {
    return itemId ? `${automationId}_${itemId}` : automationId;
  }
  function triggerDate(t, item, columns) {
    const col = columns.find((c) => c.id === t.columnId);
    if (!col || col.type !== "date" && col.type !== "timeline") return null;
    const span = spanOf(col, item.values[col.id]);
    if (!span) return null;
    return t.type === "dateArrives" && col.type === "timeline" && t.which === "start" ? span.start : span.end;
  }
  function itemFireAt(t, item, columns, tz) {
    const date = triggerDate(t, item, columns);
    if (!date || !isIsoDate(date)) return null;
    const at = fireAtForDate(date, t.type === "overdue" ? 1 : t.offsetDays, t.atTime, tz);
    return at === null ? null : { fireAt: at, dateValue: date };
  }
  var del = (c, aid, iid) => ({
    kind: "delete",
    path: boardPaths.event(c.wid, c.bid, eventId(aid, iid))
  });
  function put(c, doc) {
    return {
      kind: "set",
      path: boardPaths.event(c.wid, c.bid, eventId(doc.automationId, doc.itemId)),
      data: { ...doc, updatedAt: SERVER_TIME }
    };
  }
  function itemEvents(c, a, item) {
    const t = a.trigger;
    if (t.type !== "dateArrives" && t.type !== "overdue") return [];
    if (!a.enabled || item.deleted || item.archived) return [del(c, a.id, item.id)];
    const f = itemFireAt(t, item, c.columns, c.tz);
    if (!f || f.fireAt < c.nowMs - PAST_GRACE_MS) return [del(c, a.id, item.id)];
    return [
      put(c, {
        kind: t.type === "overdue" ? "overdue" : "date",
        automationId: a.id,
        itemId: item.id,
        boardId: c.bid,
        fireAt: new Date(f.fireAt),
        status: "pending",
        attempts: 0,
        idempotencyKey: `${a.id}:${item.id}:${f.dateValue}:${t.type === "dateArrives" ? t.offsetDays : "od"}`,
        dateValue: f.dateValue
      })
    ];
  }
  function planAutomationSchedule(input) {
    const a = input.automation;
    const removeAll = () => [
      del(input, input.automationId, null),
      ...input.items.map((i) => del(input, input.automationId, i.id))
    ];
    if (!a || !a.enabled || !isScheduledAutomation(a)) return removeAll();
    const t = a.trigger;
    if (t.type === "recurring") {
      const at = nextOccurrence(t.schedule, input.nowMs, input.tz);
      if (at === null) return removeAll();
      return [
        // item-scoped events from an earlier version of this automation no longer apply
        ...input.items.map((i) => del(input, a.id, i.id)),
        put(input, {
          kind: "recurring",
          automationId: a.id,
          itemId: null,
          boardId: input.bid,
          fireAt: new Date(at),
          status: "pending",
          attempts: 0,
          idempotencyKey: `${a.id}:${at}`,
          dateValue: null
        })
      ];
    }
    return [del(input, a.id, null), ...input.items.flatMap((i) => itemEvents(input, a, i))];
  }

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
    const paths2 = [];
    for (const [k, v] of Object.entries(data)) {
      const here = mask && k.includes(".") ? [...prefix, ...k.split(".")] : [...prefix, k];
      const fp = here.map(seg).join(".");
      if (isSentinel(v)) {
        if (v.__op === "serverTime")
          transforms.push({ fieldPath: fp, setToServerValue: "REQUEST_TIME" });
        else if (v.__op === "deleteField") paths2.push(fp);
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
        paths2.push(fp);
      } else if (mask && v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        value[k] = clean;
        paths2.push(fp);
      } else {
        value[k] = clean;
        paths2.push(fp);
      }
    }
    return { value, transforms, paths: paths2 };
  }
  var PreconditionFailed = class extends Error {
    constructor(message = "The document changed since it was read.") {
      super(message);
      this.name = "PreconditionFailed";
    }
  };
  function opsToWrites(projectId, ops, preconditions = /* @__PURE__ */ new Map()) {
    const root = `projects/${projectId}/databases/(default)/documents`;
    return ops.map((op) => {
      const name = `${root}/${op.path}`;
      const pre = preconditions.get(op.path);
      const currentDocument = pre ? pre.updateTime ? { updateTime: pre.updateTime } : { exists: pre.exists === true } : void 0;
      if (op.kind === "delete")
        return { delete: name, ...currentDocument ? { currentDocument } : {} };
      if (op.kind === "set") {
        const w2 = walk(op.data, [], false);
        return {
          update: { name, fields: toFields(w2.value) },
          ...w2.transforms.length ? { updateTransforms: w2.transforms } : {},
          ...currentDocument ? { currentDocument } : {}
        };
      }
      const w = walk(op.data, [], true);
      return {
        update: { name, fields: toFields(w.value) },
        updateMask: { fieldPaths: w.paths },
        ...w.transforms.length ? { updateTransforms: w.transforms } : {},
        currentDocument: currentDocument ?? { exists: true }
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
      const msg2 = json2?.error?.message ?? `HTTP ${status}`;
      this.p.log(`Firestore ${what} failed: ${status} ${msg2}`);
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
    batchGet(paths2) {
      if (paths2.length === 0) return [];
      const names = paths2.map((x) => `projects/${this.projectId}/databases/(default)/documents/${x}`);
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
    commit(ops, preconditions) {
      for (let i = 0; i < ops.length; i += 400) {
        const writes = opsToWrites(this.projectId, ops.slice(i, i + 400), preconditions);
        const { status, json: json2 } = this.call(`${this.base}:commit`, "POST", { writes });
        if (status === 409 || json2?.error?.status === "FAILED_PRECONDITION" || json2?.error?.status === "ABORTED")
          throw new PreconditionFailed();
        if (status !== 200) this.fail(status, json2, "commit");
      }
    }
  };

  // src/drive.ts
  var DRIVE = "https://www.googleapis.com/drive/v3";
  var UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  var SESSION_TTL_SECONDS = 6 * 3600;
  var MAX_UPLOADS_PER_HOUR = 40;
  function driveFail(res, what, p) {
    p.log(`Drive ${what} failed: ${res.status} ${res.body.slice(0, 300)}`);
    if (res.status === 429 || res.status >= 500)
      throw new HelperError("unavailable", "Google Drive is busy. Try again shortly.");
    if (res.status === 403 || res.status === 401)
      throw new HelperError(
        "internal",
        "The helper isn’t allowed to use Google Drive (check the Drive API is enabled and the folder is yours)."
      );
    if (res.status === 404) throw new HelperError("not_found", "That Drive item was not found.");
    throw new HelperError("internal", "Google Drive refused the request.");
  }
  function driveJson(p, what, req) {
    const res = p.http({ ...req, oauth: true });
    if (res.status < 200 || res.status > 299) driveFail(res, what, p);
    try {
      return JSON.parse(res.body);
    } catch {
      throw new HelperError("internal", "Google Drive sent an unreadable reply.");
    }
  }
  function ensureWorkspaceFolder(p, cfg, db, wid) {
    if (!cfg.driveRootFolderId)
      throw new HelperError("unavailable", "The Drive folder hasn’t been set up for the helper.");
    const path = `workspaces/${wid}`;
    const ws = db.getDoc(path);
    if (!ws) throw new HelperError("not_found", "That household was not found.");
    const existing = ws.data["driveFolderId"];
    if (typeof existing === "string" && existing) return existing;
    const wsName = sanitizeFileName(ws.data["name"] ?? "Household").slice(0, 80);
    const made = driveJson(p, "create folder", {
      url: `${DRIVE}/files?fields=id`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Sorted – ${wsName}`,
        mimeType: "application/vnd.google-apps.folder",
        parents: [cfg.driveRootFolderId]
      })
    });
    try {
      db.commit(
        [{ kind: "update", path, data: { driveFolderId: made.id } }],
        /* @__PURE__ */ new Map([[path, { updateTime: ws.updateTime ?? void 0 }]])
      );
      return made.id;
    } catch (e) {
      if (!(e instanceof PreconditionFailed)) throw e;
      const again = db.getDoc(path)?.data["driveFolderId"];
      if (typeof again === "string" && again) {
        p.http({
          url: `${DRIVE}/files/${made.id}`,
          method: "PATCH",
          oauth: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true })
        });
        return again;
      }
      const fresh = db.getDoc(path);
      db.commit(
        [{ kind: "update", path, data: { driveFolderId: made.id } }],
        /* @__PURE__ */ new Map([[path, { updateTime: fresh?.updateTime ?? void 0 }]])
      );
      return made.id;
    }
  }
  function rateLimit(p, uid) {
    const key = `uprl:${uid}`;
    const n = Number(p.cacheGet(key) ?? "0");
    if (n >= MAX_UPLOADS_PER_HOUR)
      throw new HelperError("rate_limited", "That’s a lot of uploads. Try again in a little while.");
    p.cachePut(key, String(n + 1), 3600);
  }
  function uploadStart(p, cfg, db, caller, wid, req) {
    const problem = uploadProblem(req["name"], req["size"]);
    if (problem) throw new HelperError(problem.includes("MB") ? "too_large" : "bad_request", problem);
    const size = req["size"];
    const name = sanitizeFileName(req["name"]);
    const mime = cleanMimeType(req["mimeType"]);
    rateLimit(p, caller.uid);
    const folder = ensureWorkspaceFolder(p, cfg, db, wid);
    const res = p.http({
      url: `${UPLOAD}?uploadType=resumable&fields=id,name,mimeType,size`,
      method: "POST",
      oauth: true,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(size)
      },
      body: JSON.stringify({
        name,
        mimeType: mime,
        parents: [folder],
        description: `Uploaded by ${caller.email ?? caller.uid} via Sorted`
      })
    });
    const session = res.headers?.["location"];
    if (res.status !== 200 || !session || !session.startsWith("https://"))
      driveFail(res, "start upload", p);
    const uploadId = p.uuid();
    const state = { uid: caller.uid, wid, session, size, name, mime, next: 0 };
    p.cachePut(`up:${uploadId}`, JSON.stringify(state), SESSION_TTL_SECONDS);
    return { uploadId, chunkBytes: UPLOAD_CHUNK_BYTES };
  }
  function decodedLength(b64) {
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return b64.length / 4 * 3 - pad;
  }
  function uploadChunk(p, caller, wid, req) {
    const id = req["uploadId"];
    if (typeof id !== "string" || !/^[A-Za-z0-9]{8,64}$/.test(id))
      throw new HelperError("bad_request", "That upload isn’t valid.");
    const raw = p.cacheGet(`up:${id}`);
    const st = raw ? JSON.parse(raw) : null;
    if (!st || st.uid !== caller.uid || st.wid !== wid)
      throw new HelperError("not_found", "That upload has expired. Please start it again.");
    const offset = req["offset"];
    const data = req["data"];
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > st.size)
      throw new HelperError("bad_request", "That piece’s position isn’t valid.");
    if (typeof data !== "string" || data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new HelperError("bad_request", "That piece isn’t valid.");
    if (offset < st.next) return { done: false, next: st.next };
    if (offset > st.next)
      throw new HelperError("bad_request", "A piece is missing. Please start the upload again.");
    const len = decodedLength(data);
    const expected = Math.min(UPLOAD_CHUNK_BYTES, st.size - offset);
    if (len !== expected) throw new HelperError("bad_request", "That piece is the wrong size.");
    const end = offset + len;
    const res = p.http({
      url: st.session,
      method: "PUT",
      oauth: true,
      headers: { "Content-Range": `bytes ${offset}-${end - 1}/${st.size}` },
      bodyBase64: data,
      followRedirects: false
    });
    if (res.status === 308) {
      st.next = end;
      p.cachePut(`up:${id}`, JSON.stringify(st), SESSION_TTL_SECONDS);
      return { done: false, next: end };
    }
    if (res.status === 200 || res.status === 201) {
      if (end !== st.size) driveFail(res, "finish upload early", p);
      p.cachePut(`up:${id}`, "", 1);
      let meta;
      try {
        meta = JSON.parse(res.body);
      } catch {
        meta = {};
      }
      if (typeof meta.id !== "string") driveFail(res, "finish upload", p);
      return {
        done: true,
        file: {
          driveFileId: meta.id,
          name: typeof meta.name === "string" ? meta.name : st.name,
          mimeType: typeof meta.mimeType === "string" ? meta.mimeType : st.mime,
          size: Number(meta.size ?? st.size),
          url: driveViewUrl(meta.id)
        }
      };
    }
    if (res.status === 404 || res.status === 410) {
      p.cachePut(`up:${id}`, "", 1);
      throw new HelperError("not_found", "That upload has expired. Please start it again.");
    }
    driveFail(res, "upload piece", p);
  }
  function planSharing(members, current) {
    const want = new Set(members.map((m) => m.trim().toLowerCase()).filter((m) => m.includes("@")));
    const have = /* @__PURE__ */ new Map();
    const remove = [];
    for (const perm of current) {
      if (perm.type !== "user" || !perm.emailAddress) continue;
      const email = perm.emailAddress.toLowerCase();
      if (perm.role === "owner" || perm.role === "organizer" || perm.role === "fileOrganizer")
        continue;
      have.set(email, perm);
      if (perm.role === "reader" && !want.has(email)) remove.push(perm);
    }
    const add = [...want].filter((e) => !have.has(e)).sort();
    return { add, remove };
  }
  var SYNC_MIN_GAP_SECONDS = 60;
  function syncFolderSharing(p, cfg, db, wid, opts = {}) {
    const gapKey = `sync:${wid}`;
    if (!opts.force && p.cacheGet(gapKey)) return { shared: 0, added: 0, removed: 0, skipped: true };
    p.cachePut(gapKey, "1", SYNC_MIN_GAP_SECONDS);
    const folder = ensureWorkspaceFolder(p, cfg, db, wid);
    const members = db.query({ parent: `workspaces/${wid}`, collection: "members", limit: 200 }).map((d) => d.data["email"]).filter((e) => typeof e === "string");
    const perms = driveJson(p, "list permissions", {
      url: `${DRIVE}/files/${folder}/permissions?fields=${encodeURIComponent("permissions(id,type,role,emailAddress)")}&pageSize=100`
    }).permissions ?? [];
    const plan = planSharing(members, perms);
    let added = 0;
    for (const email of plan.add) {
      const res = p.http({
        url: `${DRIVE}/files/${folder}/permissions?sendNotificationEmail=false`,
        method: "POST",
        oauth: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "user", role: "reader", emailAddress: email })
      });
      if (res.status === 200) added++;
      else p.log(`Drive share with ${email} skipped: ${res.status}`);
    }
    let removed = 0;
    for (const perm of plan.remove) {
      const res = p.http({
        url: `${DRIVE}/files/${folder}/permissions/${perm.id}`,
        method: "DELETE",
        oauth: true
      });
      if (res.status === 204 || res.status === 200 || res.status === 404) removed++;
      else p.log(`Drive unshare ${perm.id} failed: ${res.status}`);
    }
    return { shared: members.length, added, removed, skipped: false };
  }
  function syncAllFolders(p, cfg, db) {
    const workspaces = db.query({ collection: "workspaces", limit: 100 });
    let n = 0;
    for (const w of workspaces) {
      try {
        syncFolderSharing(p, cfg, db, w.id, { force: true });
        n++;
      } catch (e) {
        p.log(`Folder sync for ${w.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return n;
  }
  function createDoc(p, cfg, db, caller, wid, req) {
    const name = sanitizeFileName(req["name"]) || "Untitled document";
    rateLimit(p, caller.uid);
    const folder = ensureWorkspaceFolder(p, cfg, db, wid);
    const made = driveJson(p, "create document", {
      url: `${DRIVE}/files?fields=id,name`,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        name,
        mimeType: GOOGLE_DOC,
        parents: [folder],
        description: `Created by ${caller.email ?? caller.uid} via Sorted`
      })
    });
    if (typeof made.id !== "string")
      throw new HelperError("internal", "Google Drive refused the request.");
    const editors = db.query({ parent: `workspaces/${wid}`, collection: "members", limit: 200 }).filter((d) => d.data["role"] !== "viewer").map((d) => d.data["email"]).filter((e) => typeof e === "string");
    for (const email of new Set(editors.map((e) => e.toLowerCase()))) {
      const res = p.http({
        url: `${DRIVE}/files/${made.id}/permissions?sendNotificationEmail=false`,
        method: "POST",
        oauth: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "user", role: "writer", emailAddress: email })
      });
      if (res.status !== 200) p.log(`Doc share with ${email} skipped: ${res.status}`);
    }
    return {
      driveFileId: made.id,
      name: made.name ?? name,
      mimeType: GOOGLE_DOC,
      size: 0,
      url: googleDocUrl(made.id)
    };
  }

  // src/backup.ts
  var BACKUPS_TO_KEEP = 8;
  var WEEK_MS = 6.5 * 864e5;
  var PROP = "BACKUP_LAST";
  var asRecord = (d) => ({ id: d.id, ...d.data });
  function collectWorkspace(db, wid, nowIso) {
    const root = `workspaces/${wid}`;
    const sub = (parent, collection) => db.query({ parent, collection }).map(asRecord);
    const ws = db.getDoc(root);
    const boards = db.query({ parent: root, collection: "boards" }).map((b) => ({
      ...asRecord(b),
      views: sub(b.path, "views"),
      automations: sub(b.path, "automations"),
      counter: db.getDoc(`${b.path}/meta/counter`)?.data ?? null,
      items: sub(b.path, "items")
    }));
    return {
      format: "sorted-backup",
      version: 1,
      createdAt: nowIso,
      workspace: ws ? asRecord(ws) : { id: wid },
      members: sub(root, "members"),
      invites: sub(root, "invites"),
      folders: sub(root, "folders"),
      boards
    };
  }
  function asciiJson(value) {
    return JSON.stringify(value).replace(
      /[\u0080-￿]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
  }
  function ensureBackupsFolder(p, parent) {
    const q = `name='Backups' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const found = driveJson(p, "find backups folder", {
      url: `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`
    }).files?.[0];
    if (found) return found.id;
    return driveJson(p, "create backups folder", {
      url: `${DRIVE}/files?fields=id`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Backups",
        mimeType: "application/vnd.google-apps.folder",
        parents: [parent]
      })
    }).id;
  }
  function uploadJson(p, folderId, name, body) {
    const start = p.http({
      url: `${UPLOAD}?uploadType=resumable&fields=id`,
      method: "POST",
      oauth: true,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/json",
        "X-Upload-Content-Length": String(body.length)
      },
      body: JSON.stringify({ name, mimeType: "application/json", parents: [folderId] })
    });
    const session = start.headers?.["location"];
    if (start.status !== 200 || !session)
      throw new HelperError("internal", `Drive refused the backup upload (${start.status}).`);
    const put2 = p.http({
      url: session,
      method: "PUT",
      oauth: true,
      headers: { "Content-Range": `bytes 0-${body.length - 1}/${body.length}` },
      body,
      followRedirects: false
    });
    if (put2.status !== 200 && put2.status !== 201)
      throw new HelperError("internal", `Drive refused the backup file (${put2.status}).`);
    return JSON.parse(put2.body).id;
  }
  function pruneOld(p, folderId, keep) {
    const list = driveJson(p, "list backups", {
      url: `${DRIVE}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and name contains 'backup-'`)}&orderBy=${encodeURIComponent("createdTime desc")}&fields=files(id,name)&pageSize=100`
    }).files;
    const old = (list ?? []).slice(keep);
    for (const f of old)
      p.http({
        url: `${DRIVE}/files/${f.id}`,
        method: "PATCH",
        oauth: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true })
      });
    return old.length;
  }
  function backupWorkspace(p, cfg, db, wid) {
    try {
      const now = new Date(p.nowMs());
      const data = collectWorkspace(db, wid, now.toISOString());
      const body = asciiJson(data);
      const folder = ensureBackupsFolder(p, ensureWorkspaceFolder(p, cfg, db, wid));
      uploadJson(p, folder, `backup-${now.toISOString().slice(0, 10)}.json`, body);
      const removed = pruneOld(p, folder, BACKUPS_TO_KEEP);
      return { workspaceId: wid, ok: true, bytes: body.length, removed };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      p.log(`Backup of ${wid} failed: ${error}`);
      return { workspaceId: wid, ok: false, error: error.slice(0, 200) };
    }
  }
  function lastTimes(p) {
    try {
      return JSON.parse(p.prop(PROP) ?? "{}");
    } catch {
      return {};
    }
  }
  function backupDue(p, cfg, db, opts = {}) {
    const last = lastTimes(p);
    const results = [];
    for (const w of db.query({ collection: "workspaces", limit: 100 })) {
      if (opts.deadline && p.nowMs() >= opts.deadline) break;
      if (!opts.force && p.nowMs() - (last[w.id] ?? 0) < WEEK_MS) continue;
      const r = backupWorkspace(p, cfg, db, w.id);
      results.push(r);
      if (r.ok) {
        last[w.id] = p.nowMs();
        p.setProp(PROP, JSON.stringify(last));
      }
    }
    return results;
  }
  function lastBackups(p) {
    return lastTimes(p);
  }

  // src/digest.ts
  var APP_URL = "https://life-management-de315.web.app";
  var SENT_PROP = "DIGEST_SENT";
  var COUNT_PROP = "DIGEST_COUNT";
  var QUOTA_MARGIN = 5;
  var MAX_ROWS_PER_SECTION = 25;
  var escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  var SECTIONS = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Due today" },
    { key: "week", label: "Due in the next 7 days" }
  ];
  var count = (w) => w.overdue.length + w.today.length + w.week.length;
  function composeDigest(input) {
    const total = input.workspaces.reduce((n, w) => n + count(w), 0);
    if (total === 0 && input.unread === 0) return null;
    const overdue = input.workspaces.reduce((n, w) => n + w.overdue.length, 0);
    const today = input.workspaces.reduce((n, w) => n + w.today.length, 0);
    const bits = [
      overdue ? `${overdue} overdue` : "",
      today ? `${today} due today` : "",
      !overdue && !today && total ? `${total} coming up` : "",
      input.unread ? `${input.unread} unread` : ""
    ].filter(Boolean);
    const subject = `Sorted: ${bits.join(", ")}`;
    const text = [`Good morning ${input.person},`, ""];
    const html = [
      `<div style="font-family:system-ui,Arial,sans-serif;color:#1b1f2a;max-width:560px">`,
      `<p>Good morning ${escapeHtml(input.person)},</p>`
    ];
    for (const w of input.workspaces) {
      if (count(w) === 0) continue;
      text.push(w.name.toUpperCase());
      html.push(`<h2 style="font-size:18px;margin:20px 0 4px">${escapeHtml(w.name)}</h2>`);
      for (const s of SECTIONS) {
        const rows = w[s.key];
        if (rows.length === 0) continue;
        text.push(`${s.label}:`);
        html.push(
          `<h3 style="font-size:14px;margin:12px 0 4px;color:#555">${s.label}</h3><ul style="margin:0;padding-left:20px">`
        );
        for (const r of rows.slice(0, MAX_ROWS_PER_SECTION)) {
          text.push(`  - ${r.name} (${r.board}, ${r.due}) ${r.url}`);
          html.push(
            `<li><a href="${escapeHtml(r.url)}" style="color:#4a3fc7">${escapeHtml(r.name)}</a> <span style="color:#666">· ${escapeHtml(r.board)} · ${escapeHtml(r.due)}</span></li>`
          );
        }
        if (rows.length > MAX_ROWS_PER_SECTION) {
          text.push(`  …and ${rows.length - MAX_ROWS_PER_SECTION} more`);
          html.push(`<li>…and ${rows.length - MAX_ROWS_PER_SECTION} more</li>`);
        }
        html.push("</ul>");
        text.push("");
      }
    }
    if (input.unread > 0) {
      const n = `${input.unread} unread notification${input.unread === 1 ? "" : "s"}`;
      text.push(`You have ${n}: ${APP_URL}`);
      html.push(`<p>You have <a href="${APP_URL}" style="color:#4a3fc7">${n}</a>.</p>`);
    }
    text.push(
      "",
      "You get this because you turned on the daily summary in Sorted. Turn it off any time in the notifications menu."
    );
    html.push(
      `<p style="color:#777;font-size:12px;margin-top:24px">You get this because you turned on the daily summary in Sorted. Turn it off any time in the notifications menu.</p></div>`
    );
    return { subject, text: text.join("\n"), html: html.join("") };
  }
  function readJson(p, name, fallback) {
    try {
      return JSON.parse(p.prop(name) ?? "");
    } catch {
      return fallback;
    }
  }
  function runDigest(p, db) {
    const today = localDateIn(p.nowMs(), DEFAULT_TIMEZONE);
    const sentMap = readJson(p, SENT_PROP, {});
    const counter = readJson(p, COUNT_PROP, { date: today, n: 0 });
    if (counter.date !== today) {
      counter.date = today;
      counter.n = 0;
    }
    const summary = {
      sent: 0,
      skipped: { alreadySent: 0, empty: 0, optedOut: 0, capped: 0 },
      failed: 0
    };
    const people = /* @__PURE__ */ new Map();
    const workspaceNames = /* @__PURE__ */ new Map();
    for (const w of db.query({ collection: "workspaces", limit: 100 })) {
      workspaceNames.set(w.id, String(w.data["name"] ?? "Household"));
      for (const m of db.query({ parent: `workspaces/${w.id}`, collection: "members", limit: 200 })) {
        const email = m.data["email"];
        if (typeof email !== "string" || !email.includes("@")) continue;
        const person = people.get(m.id) ?? {
          uid: m.id,
          email,
          name: String(m.data["displayName"] ?? email),
          workspaces: []
        };
        person.workspaces.push({ id: w.id, role: String(m.data["role"] ?? "member") });
        people.set(m.id, person);
      }
    }
    if (people.size === 0) return summary;
    const users = new Map(
      db.batchGet([...people.keys()].map((u) => `users/${u}`)).map((d) => [d.id, d.data])
    );
    for (const person of people.values()) {
      const settings = users.get(person.uid)?.["settings"] ?? {};
      if (settings.emailDigest !== true) {
        summary.skipped.optedOut++;
        continue;
      }
      if (sentMap[person.uid] === today) {
        summary.skipped.alreadySent++;
        continue;
      }
      if (counter.n >= LIMITS.MAX_DIGEST_EMAILS_PER_DAY || p.mailQuota() <= QUOTA_MARGIN) {
        summary.skipped.capped++;
        continue;
      }
      try {
        const mail = composeDigest(gather(p, db, person, workspaceNames, today));
        if (!mail) {
          summary.skipped.empty++;
          continue;
        }
        sentMap[person.uid] = today;
        p.setProp(SENT_PROP, JSON.stringify(prune(sentMap, today)));
        p.sendMail({ to: person.email, ...mail });
        counter.n++;
        p.setProp(COUNT_PROP, JSON.stringify(counter));
        summary.sent++;
      } catch (e) {
        summary.failed++;
        p.log(`Digest for ${person.uid} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return summary;
  }
  function prune(map, today) {
    return Object.fromEntries(Object.entries(map).filter(([, d]) => d === today));
  }
  function gather(p, db, person, names, today) {
    const workspaces = [];
    let unread = 0;
    for (const ws of person.workspaces) {
      const out = {
        name: names.get(ws.id) ?? "Household",
        overdue: [],
        today: [],
        week: []
      };
      const boards = db.query({ parent: `workspaces/${ws.id}`, collection: "boards", limit: 100 });
      for (const b of boards) {
        if (b.data["archived"] === true) continue;
        const memberIds = Array.isArray(b.data["memberIds"]) ? b.data["memberIds"] : [];
        if (b.data["visibility"] === "private" && ws.role !== "admin" && !memberIds.includes(person.uid))
          continue;
        const columns = b.data["columns"] ?? [];
        const items = db.query({
          parent: b.path,
          collection: "items",
          where: [{ field: "assigneeUids", op: "ARRAY_CONTAINS", value: person.uid }],
          limit: 300
        });
        for (const it of items) {
          if (it.data["deletedAt"] != null || it.data["archived"] === true) continue;
          const values = it.data["values"] ?? {};
          if (isDone(columns, values)) continue;
          const due = dueDateOf(columns, values);
          const bucket = bucketOf(due, today);
          if (bucket !== "overdue" && bucket !== "today" && bucket !== "week") continue;
          out[bucket].push({
            name: String(it.data["name"] ?? "Untitled"),
            board: String(b.data["name"] ?? "List"),
            due: due ?? "",
            url: `${APP_URL}/w/${ws.id}/b/${b.id}?item=${it.id}`
          });
        }
      }
      for (const k of ["overdue", "today", "week"])
        out[k].sort((a, c) => a.due.localeCompare(c.due));
      workspaces.push(out);
      const note = db.query({
        parent: `workspaces/${ws.id}/notifications/${person.uid}`,
        collection: "items",
        where: [{ field: "read", op: "EQUAL", value: false }],
        limit: 50
      });
      unread += note.length;
    }
    void p;
    return { person: person.name.split(" ")[0] ?? person.name, workspaces, unread };
  }

  // src/housekeeping.ts
  var TOMBSTONE_DAYS = 30;
  var ACTIVITY_DAYS = 180;
  var RUN_HISTORY_DAYS = 30;
  var READ_NOTIFICATION_DAYS = 30;
  var ANY_NOTIFICATION_DAYS = 90;
  var DAY = 864e5;
  var BATCH = 200;
  var MAX_PER_STEP = 2e3;
  var errText = (e) => e instanceof Error ? e.message : String(e);
  function purge(ctx, spec, opts = {}) {
    let deleted = 0;
    for (; ; ) {
      if (ctx.p.nowMs() >= ctx.deadline) return { deleted, more: true };
      if (deleted >= MAX_PER_STEP) return { deleted, more: true };
      const docs = ctx.db.query({ ...spec, limit: BATCH });
      const doomed = opts.keep ? docs.filter((d) => !opts.keep(d)) : docs;
      if (doomed.length > 0) {
        ctx.db.commit(doomed.map((d) => ({ kind: "delete", path: d.path })));
        opts.onDeleted?.(doomed);
        deleted += doomed.length;
      }
      if (docs.length < BATCH) return { deleted, more: false };
      if (doomed.length === 0) return { deleted, more: false };
    }
  }
  var olderThan = (field, now, days) => ({
    field,
    op: "LESS_THAN_OR_EQUAL",
    value: new Date(now - days * DAY)
  });
  function step(ctx, name, body) {
    try {
      return { name, ...body() };
    } catch (e) {
      ctx.p.log(`Housekeeping step “${name}” failed: ${errText(e)}`);
      return { name, deleted: 0, more: false, error: errText(e).slice(0, 200) };
    }
  }
  function purgeTombstones(ctx) {
    const now = ctx.p.nowMs();
    let threads = 0;
    const r = purge(
      ctx,
      {
        collection: "items",
        group: true,
        where: [olderThan("deletedAt", now, TOMBSTONE_DAYS)]
      },
      {
        // Notifications also live in collections called "items": only ever touch board items.
        keep: (d) => !/^workspaces\/[^/]+\/boards\/[^/]+\/items\/[^/]+$/.test(d.path),
        onDeleted: (docs) => {
          for (const d of docs) {
            for (let i = 0; i < 10; i++) {
              const updates = ctx.db.query({ parent: d.path, collection: "updates", limit: BATCH });
              if (updates.length === 0) break;
              ctx.db.commit(updates.map((u) => ({ kind: "delete", path: u.path })));
              threads += updates.length;
            }
          }
        }
      }
    );
    return { deleted: r.deleted + threads, more: r.more };
  }
  function purgeNotifications(ctx) {
    const now = ctx.p.nowMs();
    const workspaces = ctx.db.query({ collection: "workspaces", limit: 100 });
    let deleted = 0;
    let more = false;
    for (const w of workspaces) {
      const members = ctx.db.query({
        parent: `workspaces/${w.id}`,
        collection: "members",
        limit: 200
      });
      for (const m of members) {
        const parent = paths.notifications(w.id, m.id).replace(/\/items$/, "");
        const a = purge(
          ctx,
          {
            parent,
            collection: "items",
            where: [olderThan("createdAt", now, READ_NOTIFICATION_DAYS)]
          },
          { keep: (d) => d.data["read"] !== true }
        );
        const b = purge(ctx, {
          parent,
          collection: "items",
          where: [olderThan("createdAt", now, ANY_NOTIFICATION_DAYS)]
        });
        deleted += a.deleted + b.deleted;
        more = more || a.more || b.more;
      }
    }
    return { deleted, more };
  }
  function runHousekeeping(p, db, opts = {}) {
    const ctx = { p, db, deadline: p.nowMs() + (opts.budgetMs ?? 4 * 6e4) };
    const now = p.nowMs();
    const steps = [
      step(ctx, "deleted items", () => purgeTombstones(ctx)),
      step(
        ctx,
        "activity log",
        () => purge(ctx, {
          collection: "activity",
          group: true,
          where: [olderThan("at", now, ACTIVITY_DAYS)]
        })
      ),
      step(
        ctx,
        "automation history",
        () => purge(ctx, {
          collection: "automationRuns",
          group: true,
          where: [olderThan("at", now, RUN_HISTORY_DAYS)]
        })
      ),
      step(ctx, "notifications", () => purgeNotifications(ctx))
    ];
    return { at: new Date(now).toISOString(), steps };
  }

  // src/nightly.ts
  var NIGHTLY_PROP = "LAST_NIGHTLY";
  var DIGEST_PROP = "LAST_DIGEST";
  var msg = (e) => e instanceof Error ? e.message : String(e);
  function runNightly(p) {
    const cfg = loadConfig(p);
    const db = new FirestoreClient(p, cfg.projectId);
    const started = p.nowMs();
    const housekeeping = runHousekeeping(p, db, { budgetMs: 3 * 6e4 });
    let foldersChecked = 0;
    try {
      foldersChecked = syncAllFolders(p, cfg, db);
    } catch (e) {
      p.log(`Folder sync failed: ${msg(e)}`);
    }
    let backups = [];
    try {
      backups = backupDue(p, cfg, db, { deadline: started + 5 * 6e4 });
    } catch (e) {
      p.log(`Backups failed: ${msg(e)}`);
    }
    const report = { housekeeping, foldersChecked, backups };
    p.setProp(NIGHTLY_PROP, JSON.stringify({ at: new Date(p.nowMs()).toISOString(), ...report }));
    return report;
  }
  function runMorning(p) {
    const cfg = loadConfig(p);
    const summary = runDigest(p, new FirestoreClient(p, cfg.projectId));
    p.setProp(DIGEST_PROP, JSON.stringify({ at: new Date(p.nowMs()).toISOString(), ...summary }));
    return summary;
  }
  var parse = (s) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  function maintenanceStatus(p, workspaceId) {
    if (!workspaceId) throw new HelperError("bad_request", "A household is required.");
    const n = parse(p.prop(NIGHTLY_PROP));
    const d = parse(p.prop(DIGEST_PROP));
    const last = lastBackups(p)[workspaceId];
    return {
      nightly: n && {
        at: n.at,
        deleted: n.housekeeping.steps.reduce((s, x) => s + x.deleted, 0),
        problems: n.housekeeping.steps.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`),
        backups: {
          ok: n.backups.filter((b) => b.ok).length,
          failed: n.backups.filter((b) => !b.ok).length
        }
      },
      digest: d && { at: d.at, sent: d.sent, failed: d.failed },
      lastBackupAt: last ? new Date(last).toISOString() : null
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
          ...req.bodyBase64 !== void 0 ? { payload: Utilities.newBlob(Utilities.base64Decode(req.bodyBase64)).getBytes() } : req.body !== void 0 ? { payload: req.body } : {},
          muteHttpExceptions: true,
          followRedirects: req.followRedirects ?? true
        });
        const headers2 = {};
        for (const [k, v] of Object.entries(res.getAllHeaders()))
          headers2[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
        return { status: res.getResponseCode(), body: res.getContentText(), headers: headers2 };
      },
      cacheGet: (k) => cache.get(k),
      cachePut: (k, v, ttl) => {
        cache.put(k, v, Math.min(ttl, 21600));
      },
      prop: (n) => props.getProperty(n),
      setProp: (n, v) => void props.setProperty(n, v),
      sendMail: (m) => MailApp.sendEmail({
        to: m.to,
        subject: m.subject,
        body: m.text,
        htmlBody: m.html,
        name: "Sorted",
        noReply: true
      }),
      mailQuota: () => MailApp.getRemainingDailyQuota(),
      nowMs: () => Date.now(),
      uuid: () => Utilities.getUuid().replace(/-/g, ""),
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
      throw new HelperError("bad_request", "A household is required.");
    const m = db.getDoc(`workspaces/${workspaceId}/members/${uid}`);
    const role = m?.data["role"];
    if (!m || typeof role !== "string" || !ROLES.includes(role))
      throw new HelperError("forbidden", "You are not a member of this household.");
    return role;
  }

  // src/scheduler.ts
  var RUN_BUDGET_MS = 4 * 60 * 1e3;
  var MAX_EVENTS_PER_RUN = 100;
  var MAX_ATTEMPTS = 3;
  var RETRY_DELAY_MS = 10 * 60 * 1e3;
  var MAX_ITEMS_PER_BOARD = 600;
  var MAX_TARGETS_PER_FIRE = 100;
  var HOUR = 3600 * 1e3;
  var EVENT_PATH = /^workspaces\/([^/]+)\/boards\/([^/]+)\/scheduledEvents\/([^/]+)$/;
  function parseEvent(doc) {
    const m = EVENT_PATH.exec(doc.path);
    if (!m) return null;
    const d = doc.data;
    const fireAt = d["fireAt"] instanceof Date ? d["fireAt"].getTime() : NaN;
    if (typeof d["automationId"] !== "string" || !Number.isFinite(fireAt)) return null;
    return {
      doc,
      wid: m[1],
      bid: m[2],
      eid: m[3],
      kind: String(d["kind"] ?? ""),
      automationId: d["automationId"],
      itemId: typeof d["itemId"] === "string" ? d["itemId"] : null,
      fireAt,
      attempts: typeof d["attempts"] === "number" ? d["attempts"] : 0,
      dateValue: typeof d["dateValue"] === "string" ? d["dateValue"] : null
    };
  }
  function toEngineItem(doc) {
    const d = doc.data;
    return {
      id: doc.id,
      name: String(d["name"] ?? ""),
      groupId: String(d["groupId"] ?? ""),
      order: String(d["order"] ?? "a0"),
      parentId: typeof d["parentId"] === "string" ? d["parentId"] : null,
      itemNumber: typeof d["itemNumber"] === "number" ? d["itemNumber"] : 0,
      values: d["values"] && typeof d["values"] === "object" ? d["values"] : {},
      archived: d["archived"] === true,
      deleted: d["deletedAt"] != null,
      assigneeUids: Array.isArray(d["assigneeUids"]) ? d["assigneeUids"] : []
    };
  }
  function loadBoard(db, wid, bid) {
    const ws = db.getDoc(`workspaces/${wid}`);
    const board = db.getDoc(`workspaces/${wid}/boards/${bid}`);
    if (!ws || !board) return null;
    const settings = ws.data["settings"] ?? {};
    const members = db.query({ collection: "members", parent: `workspaces/${wid}`, limit: 200 });
    const automations = db.query({ collection: "automations", parent: `workspaces/${wid}/boards/${bid}`, limit: 50 }).map((d) => parseAutomation(d.id, d.data)).filter((a) => a !== null);
    return {
      wid,
      bid,
      tz: typeof settings["timezone"] === "string" ? settings["timezone"] : DEFAULT_TIMEZONE,
      boardName: String(board.data["name"] ?? "List"),
      columns: Array.isArray(board.data["columns"]) ? board.data["columns"] : [],
      groups: Array.isArray(board.data["groups"]) ? board.data["groups"] : [],
      automations,
      memberUids: new Set(members.map((m) => m.id)),
      names: new Map(members.map((m) => [m.id, String(m.data["displayName"] ?? m.id)])),
      items: null
    };
  }
  function itemsOf(db, b) {
    if (!b.items) {
      b.items = new Map(
        db.query({
          collection: "items",
          parent: `workspaces/${b.wid}/boards/${b.bid}`,
          limit: MAX_ITEMS_PER_BOARD
        }).map((d) => [d.id, toEngineItem(d)])
      );
    }
    return b.items;
  }
  function runDueEvents(p, opts = {}) {
    const started = p.nowMs();
    const deadline = started + (opts.budgetMs ?? RUN_BUDGET_MS);
    const db = new FirestoreClient(p, p.prop("FIREBASE_PROJECT_ID") ?? "life-management-de315");
    const limit = opts.limit ?? MAX_EVENTS_PER_RUN;
    const sum = {
      due: 0,
      processed: 0,
      fired: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      deferred: 0
    };
    const docs = db.query({
      collection: "scheduledEvents",
      group: true,
      where: [
        { field: "status", op: "EQUAL", value: "pending" },
        { field: "fireAt", op: "LESS_THAN_OR_EQUAL", value: new Date(started) }
      ],
      orderBy: [{ field: "fireAt" }],
      limit
    });
    sum.due = docs.length;
    if (docs.length === 0) return sum;
    const boards = /* @__PURE__ */ new Map();
    for (const doc of docs) {
      if (p.nowMs() >= deadline) {
        sum.deferred = docs.length - sum.processed;
        p.log(`Scheduler out of time: ${sum.deferred} event(s) left for the next run.`);
        break;
      }
      const ev = parseEvent(doc);
      sum.processed++;
      if (!ev) {
        p.log(`Ignoring malformed event ${doc.path}`);
        sum.skipped++;
        continue;
      }
      const key = `${ev.wid}/${ev.bid}`;
      if (!boards.has(key)) {
        try {
          boards.set(key, loadBoard(db, ev.wid, ev.bid));
        } catch (e) {
          p.log(`Could not load ${key}: ${e instanceof Error ? e.message : String(e)}`);
          boards.set(key, null);
        }
      }
      const board = boards.get(key) ?? null;
      let outcome;
      try {
        outcome = board ? processEvent(p, db, board, ev) : dropEvent(db, ev);
      } catch (e) {
        outcome = recordTransientFailure(p, db, ev, e);
      }
      if (outcome === "conflict") outcome = "skipped";
      sum[outcome === "fired" ? "fired" : outcome]++;
    }
    return sum;
  }
  function dropEvent(db, ev) {
    safeCommit(
      db,
      [{ kind: "delete", path: ev.doc.path }],
      /* @__PURE__ */ new Map([[ev.doc.path, { updateTime: ev.doc.updateTime ?? void 0 }]])
    );
    return "skipped";
  }
  function safeCommit(db, ops, pre) {
    try {
      db.commit(ops, pre);
      return true;
    } catch (e) {
      if (e instanceof PreconditionFailed) return false;
      throw e;
    }
  }
  function recordTransientFailure(p, db, ev, err) {
    const attempts = ev.attempts + 1;
    const message = (err instanceof HelperError ? err.message : err instanceof Error ? err.message : String(err)).slice(0, 300);
    p.log(`Event ${ev.doc.path} failed (attempt ${attempts}): ${message}`);
    const giveUp = attempts >= MAX_ATTEMPTS;
    try {
      safeCommit(
        db,
        [
          {
            kind: "update",
            path: ev.doc.path,
            data: {
              attempts,
              lastError: message,
              status: giveUp ? "failed" : "pending",
              ...giveUp ? {} : { fireAt: new Date(p.nowMs() + RETRY_DELAY_MS * attempts) },
              updatedAt: SERVER_TIME
            }
          }
        ],
        /* @__PURE__ */ new Map([[ev.doc.path, { updateTime: ev.doc.updateTime ?? void 0 }]])
      );
    } catch (e) {
      p.log(
        `Could not record the failure for ${ev.doc.path}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    return giveUp ? "failed" : "retried";
  }
  function processEvent(p, db, b, ev) {
    const auto = b.automations.find((a) => a.id === ev.automationId);
    const pre = /* @__PURE__ */ new Map([
      [ev.doc.path, { updateTime: ev.doc.updateTime ?? void 0 }]
    ]);
    const remove = () => safeCommit(db, [{ kind: "delete", path: ev.doc.path }], pre) ? "skipped" : "conflict";
    if (!auto || !auto.enabled || !isScheduledAutomation(auto)) return remove();
    const t = auto.trigger;
    const now = p.nowMs();
    let targets;
    if (t.type === "recurring") {
      if (t.scope === "board") targets = [null];
      else {
        const all = itemsOf(db, b);
        targets = [...all.values()].filter((i) => !i.deleted && !i.archived).map((i) => i.id).slice(0, MAX_TARGETS_PER_FIRE);
      }
    } else {
      if (t.type !== "dateArrives" && t.type !== "overdue" || !ev.itemId) return remove();
      const item = itemsOf(db, b).get(ev.itemId);
      if (!item || item.deleted || item.archived) return remove();
      const f = itemFireAt(t, item, b.columns, b.tz);
      if (!f || f.dateValue !== ev.dateValue) {
        if (f && f.fireAt >= now - 6 * HOUR) {
          const moved = {
            kind: "update",
            path: ev.doc.path,
            data: { fireAt: new Date(f.fireAt), dateValue: f.dateValue, updatedAt: SERVER_TIME }
          };
          return safeCommit(db, [moved], pre) ? "skipped" : "conflict";
        }
        return remove();
      }
      if (t.type === "overdue" && isDone(b.columns, item.values)) return remove();
      targets = [ev.itemId];
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const counterDoc = db.getDoc(boardPaths.counter(b.wid, b.bid));
      const counterNow = typeof counterDoc?.data["next"] === "number" ? counterDoc.data["next"] : 1;
      const preconditions = new Map(pre);
      preconditions.set(
        boardPaths.counter(b.wid, b.bid),
        counterDoc ? { updateTime: counterDoc.updateTime ?? void 0 } : { exists: false }
      );
      let counter = counterNow;
      let state = itemsOf(db, b);
      const ops = [];
      const runs = [];
      for (const target of targets) {
        const r = runAutomations({
          wid: b.wid,
          bid: b.bid,
          boardName: b.boardName,
          event: { kind: "scheduled", automationId: auto.id, itemId: target },
          items: state,
          columns: b.columns,
          groups: b.groups,
          automations: b.automations,
          actor: auto.ownerUid,
          memberUids: b.memberUids,
          memberName: (u) => b.names.get(u) ?? "Former member",
          today: localDateIn(now, b.tz),
          startNumber: counter,
          newId: () => p.uuid()
        });
        ops.push(...r.ops);
        runs.push(...r.runs);
        state = r.items;
        if (r.counterNext !== null) counter = r.counterNext;
        for (const run of r.runs)
          if (run.status === "ok" && run.automationId === auto.id)
            ops.push(
              planActivity({
                wid: b.wid,
                bid: b.bid,
                id: p.uuid(),
                actor: auto.ownerUid,
                type: "automation",
                itemId: run.itemId && run.itemId !== "" ? run.itemId : null,
                itemName: run.itemId ? state.get(run.itemId)?.name ?? "" : "",
                data: { text: `Automation “${auto.name}” ran` }
              })
            );
      }
      if (counter !== counterNow)
        ops.push({
          kind: counterDoc ? "update" : "set",
          path: boardPaths.counter(b.wid, b.bid),
          data: { next: counter }
        });
      const mine = runs.filter((r) => r.automationId === auto.id);
      const failedRun = mine.find((r) => r.status === "failed");
      const nothingRan = mine.length === 0;
      if (t.type === "recurring") {
        const next = nextOccurrence(t.schedule, Math.max(now, ev.fireAt), b.tz);
        ops.push(
          next === null ? {
            kind: "update",
            path: ev.doc.path,
            data: { status: "done", attempts: 0, doneAt: SERVER_TIME, updatedAt: SERVER_TIME }
          } : {
            kind: "update",
            path: ev.doc.path,
            data: {
              status: "pending",
              attempts: 0,
              fireAt: new Date(next),
              idempotencyKey: `${auto.id}:${next}`,
              lastRunAt: SERVER_TIME,
              ...failedRun?.error ? { lastError: failedRun.error.slice(0, 300) } : {},
              updatedAt: SERVER_TIME
            }
          }
        );
      } else {
        ops.push({
          kind: "update",
          path: ev.doc.path,
          data: {
            status: failedRun ? "failed" : "done",
            attempts: ev.attempts + 1,
            doneAt: SERVER_TIME,
            ...failedRun?.error ? { lastError: failedRun.error.slice(0, 300) } : {},
            updatedAt: SERVER_TIME
          }
        });
      }
      try {
        db.commit(ops, preconditions);
      } catch (e) {
        if (!(e instanceof PreconditionFailed)) throw e;
        const fresh = db.getDoc(ev.doc.path);
        if (!fresh || fresh.updateTime !== ev.doc.updateTime || fresh.data["status"] !== "pending")
          return "conflict";
        b.items = null;
        continue;
      }
      b.items = new Map(state);
      return failedRun ? "failed" : nothingRan ? "skipped" : "fired";
    }
    throw new HelperError("unavailable", "The list was busy; will retry.");
  }
  function rebuildSchedule(p, db, workspaceId) {
    const ws = db.getDoc(`workspaces/${workspaceId}`);
    if (!ws) throw new HelperError("not_found", "Household not found.");
    const tz = typeof ws.data["settings"]?.["timezone"] === "string" ? ws.data["settings"]["timezone"] : DEFAULT_TIMEZONE;
    const out = { boards: 0, automations: 0, registered: 0, removed: 0 };
    const boards = db.query({
      collection: "boards",
      parent: `workspaces/${workspaceId}`,
      limit: 100
    });
    for (const bd of boards) {
      out.boards++;
      const bid = bd.id;
      const parent = `workspaces/${workspaceId}/boards/${bid}`;
      const columns = Array.isArray(bd.data["columns"]) ? bd.data["columns"] : [];
      const automations = db.query({ collection: "automations", parent, limit: 50 }).map((d) => parseAutomation(d.id, d.data)).filter((a) => a !== null);
      const items = db.query({ collection: "items", parent, limit: MAX_ITEMS_PER_BOARD }).map(toEngineItem);
      const existing = db.query({ collection: "scheduledEvents", parent, limit: 1e3 });
      const wanted = /* @__PURE__ */ new Set();
      const ops = [];
      for (const a of automations.filter((x) => x.enabled && isScheduledAutomation(x))) {
        out.automations++;
        for (const op of planAutomationSchedule({
          wid: workspaceId,
          bid,
          columns,
          tz,
          nowMs: p.nowMs(),
          automation: a,
          automationId: a.id,
          items
        })) {
          if (op.kind === "set") {
            wanted.add(op.path);
            ops.push(op);
            out.registered++;
          }
        }
      }
      for (const e of existing) {
        if (!wanted.has(e.path)) {
          ops.push({ kind: "delete", path: e.path });
          out.removed++;
        }
      }
      if (ops.length) db.commit(ops);
    }
    return out;
  }
  function queueStatus(p, db, workspaceId) {
    const boards = db.query({
      collection: "boards",
      parent: `workspaces/${workspaceId}`,
      limit: 100
    });
    let pending = 0;
    let failed = 0;
    let next = null;
    let stalled = false;
    const now = p.nowMs();
    for (const bd of boards) {
      for (const e of db.query({
        collection: "scheduledEvents",
        parent: `workspaces/${workspaceId}/boards/${bd.id}`,
        limit: 500
      })) {
        const ev = parseEvent(e);
        if (!ev) continue;
        if (e.data["status"] === "failed") failed++;
        else if (e.data["status"] === "pending") {
          pending++;
          if (next === null || ev.fireAt < next) next = ev.fireAt;
          if (ev.fireAt < now - 30 * 60 * 1e3) stalled = true;
        }
      }
    }
    return { pending, failed, nextDue: next === null ? null : new Date(next).toISOString(), stalled };
  }

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
  actions["rebuildSchedule"] = {
    auth: "admin",
    writes: true,
    run: (ctx) => rebuildSchedule(ctx.p, ctx.db, ctx.workspaceId)
  };
  actions["schedulerStatus"] = {
    auth: "admin",
    run: (ctx) => queueStatus(ctx.p, ctx.db, ctx.workspaceId)
  };
  actions["maintenanceStatus"] = {
    auth: "admin",
    run: (ctx) => maintenanceStatus(ctx.p, ctx.workspaceId)
  };
  actions["uploadStart"] = {
    auth: "member",
    writes: true,
    run: (ctx, req) => uploadStart(ctx.p, ctx.cfg, ctx.db, ctx.caller, ctx.workspaceId, req)
  };
  actions["createDoc"] = {
    auth: "member",
    writes: true,
    run: (ctx, req) => {
      if (ctx.role === "viewer")
        throw new HelperError("forbidden", "Viewers can’t create documents.");
      return createDoc(ctx.p, ctx.cfg, ctx.db, ctx.caller, ctx.workspaceId, req);
    }
  };
  actions["uploadChunk"] = {
    auth: "member",
    writes: true,
    run: (ctx, req) => uploadChunk(ctx.p, ctx.caller, ctx.workspaceId, req)
  };
  actions["syncFolderSharing"] = {
    auth: "member",
    run: (ctx) => syncFolderSharing(ctx.p, ctx.cfg, ctx.db, ctx.workspaceId)
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
            throw new HelperError("forbidden", "Only a household admin can do that.");
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
    try {
      const sum = runDueEvents(gasPlatform());
      if (sum.due > 0) console.log(`Scheduler: ${JSON.stringify(sum)}`);
    } catch (e) {
      console.error(`Scheduler failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
  }
  function runHousekeeping2() {
    try {
      const r = runNightly(gasPlatform());
      console.log(
        `Nightly: ${r.housekeeping.steps.map((x) => `${x.name} ${x.deleted}${x.error ? " (failed)" : ""}`).join(", ")}; ${r.foldersChecked} folder(s) checked; ${r.backups.filter((b) => b.ok).length} backup(s).`
      );
    } catch (e) {
      console.error(`Nightly failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
  }
  function runDigest2() {
    try {
      console.log(`Digest: ${JSON.stringify(runMorning(gasPlatform()))}`);
    } catch (e) {
      console.error(`Digest failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
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
