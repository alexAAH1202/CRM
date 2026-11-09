import { describe, expect, it } from 'vitest';
import { mentionsIn, parseRich, plainText, safeHref, type Block, type Inline } from './richText';

const people = [
  { uid: 'u1', name: 'Ada Lovelace' },
  { uid: 'u2', name: 'Ada' },
  { uid: 'u3', name: 'Bob' },
];
const inl = (s: string): Inline[] => (parseRich(s, people)[0] as { c: Inline[] }).c;
const text = (n: Inline[]): string =>
  n
    .map((x) => (x.t === 'text' ? x.v : x.t === 'br' ? '\n' : x.t === 'mention' ? x.v : text(x.c)))
    .join('');

describe('parseRich', () => {
  it('plain text stays text', () => {
    expect(parseRich('hello world')).toEqual([{ t: 'p', c: [{ t: 'text', v: 'hello world' }] }]);
    expect(parseRich('')).toEqual([]);
  });
  it('bold, italic, nesting', () => {
    expect(inl('a **b** c')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' c' },
    ]);
    expect(inl('*it*')).toEqual([{ t: 'i', c: [{ t: 'text', v: 'it' }] }]);
    expect(inl('_it_')).toEqual([{ t: 'i', c: [{ t: 'text', v: 'it' }] }]);
    expect(inl('**bold *and italic***')[0]).toMatchObject({ t: 'b' });
  });
  it('snake_case words and maths are not italic', () => {
    expect(text(inl('use snake_case_names here'))).toBe('use snake_case_names here');
    expect(inl('2 * 3 * 4').every((n) => n.t === 'text')).toBe(true);
  });
  it('links: markdown and bare, with trailing punctuation left out', () => {
    expect(inl('[docs](https://example.com/a?b=1)')).toEqual([
      { t: 'a', href: 'https://example.com/a?b=1', c: [{ t: 'text', v: 'docs' }] },
    ]);
    const bare = inl('see https://example.com/x.');
    expect(bare[1]).toMatchObject({ t: 'a', href: 'https://example.com/x' });
    expect(bare[2]).toEqual({ t: 'text', v: '.' });
  });
  it('never links dangerous schemes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'JaVaScRiPt:alert(1)',
      'vbscript:x',
      'file:///etc/passwd',
      '//evil.com',
    ]) {
      const n = inl(`[click](${bad})`);
      expect(n.some((x) => x.t === 'a')).toBe(false);
      expect(safeHref(bad)).toBeNull();
    }
    expect(safeHref('https://ok.example')).toBe('https://ok.example');
    expect(safeHref('http://ok.example')).toBe('http://ok.example');
  });
  it('HTML is just text (the UI renders text nodes, never markup)', () => {
    const n = inl('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(n.every((x) => x.t === 'text')).toBe(true);
    expect(text(n)).toContain('<script>');
  });
  it('lists and paragraphs', () => {
    const b = parseRich('intro\nsame para\n\n- one\n- two\n\n1. first\n2) second');
    expect(b.map((x) => x.t)).toEqual(['p', 'ul', 'ol']);
    expect((b[1] as Extract<Block, { t: 'ul' }>).items).toHaveLength(2);
    expect((b[2] as Extract<Block, { t: 'ol' }>).items).toHaveLength(2);
    expect((b[0] as { c: Inline[] }).c.some((x) => x.t === 'br')).toBe(true);
  });
  it('a list switching kind starts a new list', () => {
    expect(parseRich('- a\n1. b').map((x) => x.t)).toEqual(['ul', 'ol']);
  });
  it('mentions: longest name wins, word boundaries respected, emails are not mentions', () => {
    expect(inl('hi @Ada Lovelace!')[1]).toEqual({ t: 'mention', v: '@Ada Lovelace', uid: 'u1' });
    expect(inl('hi @Ada, ok')[1]).toEqual({ t: 'mention', v: '@Ada', uid: 'u2' });
    expect(inl('@Adam is not Ada').some((x) => x.t === 'mention')).toBe(false);
    expect(inl('mail bob@Bob.com').some((x) => x.t === 'mention')).toBe(false);
    expect(inl('**@Bob**')[0]).toMatchObject({ t: 'b', c: [{ t: 'mention', uid: 'u3' }] });
  });
  it('names with regex characters are safe', () => {
    const p = [{ uid: 'x', name: 'A.B (C)+' }];
    expect(() => parseRich('@A.B (C)+ hi', p)).not.toThrow();
    expect((parseRich('@A.B (C)+ hi', p)[0] as { c: Inline[] }).c[0]).toMatchObject({
      t: 'mention',
      uid: 'x',
    });
  });
  it('is bounded: huge or hostile input finishes quickly', () => {
    const t0 = Date.now();
    parseRich('*'.repeat(50000) + '_'.repeat(50000) + '['.repeat(20000));
    parseRich(('**a ' + '*b '.repeat(200)).repeat(50));
    parseRich('@'.repeat(5000), people);
    expect(Date.now() - t0).toBeLessThan(1500);
    const text5k = parseRich('x'.repeat(10000));
    const first = text5k[0] as { c: Inline[] };
    expect(text(first.c)).toHaveLength(5000);
  });
});

describe('mentionsIn / plainText', () => {
  it('finds each mentioned person once, only if still in the text', () => {
    expect(mentionsIn('@Bob and @Bob and @Ada Lovelace', people).sort()).toEqual(['u1', 'u3']);
    expect(mentionsIn('no one here', people)).toEqual([]);
    expect(mentionsIn('- @Bob\n- **@Ada**', people).sort()).toEqual(['u2', 'u3']);
  });
  it('caps mentions', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      uid: `p${i}`,
      name: `P${String(i).padStart(2, '0')}`,
    }));
    expect(mentionsIn(many.map((p) => `@${p.name}`).join(' '), many)).toHaveLength(20);
  });
  it('plainText strips markup and shortens', () => {
    expect(plainText('**Hi** [there](https://x.com)\n\n- one')).toBe('Hi there one');
    expect(plainText('x'.repeat(300), 20)).toHaveLength(20);
  });
});
