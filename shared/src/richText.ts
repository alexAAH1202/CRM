/**
 * Comments use a tiny, safe markup instead of HTML, so there is nothing to sanitise and no
 * way to smuggle in a script: **bold**, *italic*, [text](https://link), bare https:// links,
 * "- " bullet lists, "1. " numbered lists, blank line = new paragraph, and @Name mentions.
 * parseRich() turns text into a plain tree that the UI renders as React elements.
 */
export const MAX_UPDATE_LENGTH = 5000;

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'a'; href: string; c: Inline[] }
  | { t: 'mention'; v: string; uid: string }
  | { t: 'br' };

export type Block =
  { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] } | { t: 'ol'; items: Inline[][] };

export interface Person {
  uid: string;
  name: string;
}

const URL_RE = /^https?:\/\/[^\s<>()[\]]+$/i;

/** Only web links; everything else (javascript:, data:, …) stays plain text. */
export function safeHref(href: string): string | null {
  return URL_RE.test(href) ? href : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function splitMentions(text: string, people: readonly Person[]): Inline[] {
  if (people.length === 0 || !text.includes('@')) return [{ t: 'text', v: text }];
  const sorted = [...people].filter((p) => p.name).sort((a, b) => b.name.length - a.name.length);
  if (sorted.length === 0) return [{ t: 'text', v: text }];
  const re = new RegExp(
    `@(${sorted.map((p) => escapeRe(p.name)).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index as number;
    if (idx > 0 && /[\p{L}\p{N}_]/u.test(text[idx - 1] as string)) continue; // part of an email
    if (idx > last) out.push({ t: 'text', v: text.slice(last, idx) });
    const who = sorted.find((p) => p.name === m[1]) as Person;
    out.push({ t: 'mention', v: `@${who.name}`, uid: who.uid });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out.length ? out : [{ t: 'text', v: text }];
}

// One alternation, tried left to right: [text](url) | **bold** | *italic* / _italic_ | bare url
const INLINE_RE =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)([^\n]+?)(?<=\S)\*\*|(?<![\w*])\*(?=[^\s*])([^\n*]+?)(?<=[^\s*])\*(?![\w*])|(?<![\w])_(?=[^\s_])([^\n_]+?)(?<=[^\s_])_(?![\w])|(https?:\/\/[^\s<>]+)/giu;

function parseInline(text: string, people: readonly Person[], depth = 0): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index as number;
    if (idx > last) out.push(...splitMentions(text.slice(last, idx), people));
    if (m[1] !== undefined) {
      const href = safeHref(m[2] as string);
      if (href) out.push({ t: 'a', href, c: [{ t: 'text', v: m[1] }] });
      else out.push({ t: 'text', v: m[0] });
    } else if (m[3] !== undefined) {
      out.push({
        t: 'b',
        c: depth < 4 ? parseInline(m[3], people, depth + 1) : [{ t: 'text', v: m[3] }],
      });
    } else if (m[4] !== undefined || m[5] !== undefined) {
      const inner = (m[4] ?? m[5]) as string;
      out.push({
        t: 'i',
        c: depth < 4 ? parseInline(inner, people, depth + 1) : [{ t: 'text', v: inner }],
      });
    } else if (m[6] !== undefined) {
      // trailing punctuation belongs to the sentence, not the link
      const url = (m[6] as string).replace(/[.,;:!?)\]]+$/, '');
      const href = safeHref(url);
      if (href) {
        out.push({ t: 'a', href, c: [{ t: 'text', v: url }] });
        if (url.length < m[6].length)
          out.push({ t: 'text', v: (m[6] as string).slice(url.length) });
      } else out.push({ t: 'text', v: m[6] as string });
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(...splitMentions(text.slice(last), people));
  return out;
}

export function parseRich(body: string, people: readonly Person[] = []): Block[] {
  const lines = body.slice(0, MAX_UPDATE_LENGTH).replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => {
    if (!para.length) return;
    const c: Inline[] = [];
    para.forEach((ln, i) => {
      if (i > 0) c.push({ t: 'br' });
      c.push(...parseInline(ln, people));
    });
    blocks.push({ t: 'p', c });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ t: list.kind, items: list.items.map((x) => parseInline(x, people)) });
    list = null;
  };
  for (const line of lines) {
    const bullet = /^\s{0,3}[-•]\s+(.*\S.*)$/.exec(line);
    const numbered = /^\s{0,3}\d{1,3}[.)]\s+(.*\S.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push(((bullet ?? numbered) as RegExpExecArray)[1] as string);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of a body (for notification previews): markup stripped, one line, shortened. */
export function plainText(body: string, max = 140): string {
  const t = body
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The uids whose "@Name" appears in the text (so a mention deleted while editing isn't kept). */
export function mentionsIn(body: string, people: readonly Person[], max = 20): string[] {
  const found = new Set<string>();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.t === 'mention') found.add(n.uid);
      else if (n.t === 'b' || n.t === 'i' || n.t === 'a') walk(n.c);
    }
  };
  for (const b of parseRich(body, people)) {
    if (b.t === 'p') walk(b.c);
    else b.items.forEach(walk);
  }
  return [...found].slice(0, max);
}
