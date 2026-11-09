/** Converts between plain JS values and the Firestore REST API's typed JSON ("Value" objects). */
export type FsValue = Record<string, unknown>;
export type FsFields = Record<string, FsValue>;

export function toValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Firestore cannot store NaN or Infinity');
    return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object')
    return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
  throw new Error(`Cannot store a ${typeof v} in Firestore`);
}

/** Undefined properties are skipped (matching the web SDK's behaviour with ignoreUndefinedProperties). */
export function toFields(obj: Record<string, unknown>): FsFields {
  const out: FsFields = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toValue(v);
  return out;
}

export function fromValue(v: FsValue | undefined): unknown {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v['booleanValue'] === true;
  if ('integerValue' in v) return Number(v['integerValue']);
  if ('doubleValue' in v) return Number(v['doubleValue']);
  if ('stringValue' in v) return String(v['stringValue']);
  if ('timestampValue' in v) return new Date(String(v['timestampValue']));
  if ('referenceValue' in v) return String(v['referenceValue']);
  if ('bytesValue' in v) return String(v['bytesValue']);
  if ('arrayValue' in v) {
    const vals = (v['arrayValue'] as { values?: FsValue[] }).values ?? [];
    return vals.map(fromValue);
  }
  if ('mapValue' in v) return fromFields((v['mapValue'] as { fields?: FsFields }).fields ?? {});
  return null;
}

export function fromFields(fields: FsFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}

export interface FsDocument {
  name: string;
  fields?: FsFields;
  createTime?: string;
  updateTime?: string;
}

export interface Doc {
  /** Path relative to the database, e.g. workspaces/w1/members/u1. */
  path: string;
  id: string;
  data: Record<string, unknown>;
  updateTime: string | null;
}

export function decodeDoc(d: FsDocument): Doc {
  const path = d.name.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, '');
  return {
    path,
    id: path.split('/').pop() as string,
    data: fromFields(d.fields ?? {}),
    updateTime: d.updateTime ?? null,
  };
}
