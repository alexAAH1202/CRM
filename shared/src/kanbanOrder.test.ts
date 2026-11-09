import { describe, expect, it } from 'vitest';
import { parseCardOrder, parseViewOptions } from './viewConfig';
import { applyLaneOrder, dropTarget, placeInLane, withLaneOrder } from './views';

const cards = (...ids: string[]) => ids.map((id) => ({ id }));

describe('lane order', () => {
  it('applies a hand-picked order; unlisted cards follow, in their own order', () => {
    expect(applyLaneOrder(cards('a', 'b', 'c', 'd'), ['c', 'a']).map((c) => c.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
    expect(applyLaneOrder(cards('a', 'b'), undefined).map((c) => c.id)).toEqual(['a', 'b']);
    // ids in the list that are no longer in the lane are ignored
    expect(applyLaneOrder(cards('a', 'b'), ['gone', 'b']).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('places a card before another, at the end, and never duplicates it', () => {
    const lane = ['a', 'b', 'c', 'd'];
    expect(placeInLane(lane, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(placeInLane(lane, 'a', null)).toEqual(['b', 'c', 'd', 'a']);
    expect(placeInLane(lane, 'b', 'b')).toEqual(lane);
    expect(placeInLane(lane, 'x', 'c')).toEqual(['a', 'b', 'x', 'c', 'd']); // from another lane
    expect(placeInLane(lane, 'a', 'gone')).toEqual(['b', 'c', 'd', 'a']);
    expect(placeInLane(['a'], 'a', null)).toEqual(['a']);
  });

  it('dropping on a card lands next to it, on the side you came from', () => {
    const lane = ['a', 'b', 'c', 'd'];
    // dragging down: below the target
    expect(dropTarget(lane, 'a', 'c', true)).toBe('d');
    expect(dropTarget(lane, 'a', 'd', true)).toBeNull(); // last: goes to the end
    // dragging up: above the target
    expect(dropTarget(lane, 'd', 'b', true)).toBe('b');
    // from another lane: above the target
    expect(dropTarget(lane, 'x', 'c', false)).toBe('c');
    // empty space in the lane: the end
    expect(dropTarget(lane, 'a', null, true)).toBeNull();
    // the full flow gives the order a person expects
    expect(placeInLane(lane, 'a', dropTarget(lane, 'a', 'c', true))).toEqual(['b', 'c', 'a', 'd']);
    expect(placeInLane(lane, 'd', dropTarget(lane, 'd', 'b', true))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('keeps the saved map bounded and free of empty lanes', () => {
    expect(withLaneOrder({}, null, ['a', 'b'])).toEqual({ __none: ['a', 'b'] });
    expect(withLaneOrder({ x: ['1'] }, 'x', [])).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`l${i}`, ['a']]));
    const next = withLaneOrder(many, 'fresh', ['z']);
    expect(Object.keys(next).length).toBeLessThanOrEqual(41);
    expect(next['fresh']).toEqual(['z']);
    expect(
      withLaneOrder(
        {},
        'l',
        Array.from({ length: 500 }, (_, i) => `i${i}`),
      )['l'],
    ).toHaveLength(300);
  });
});

describe('cardOrder in view options', () => {
  it('parses safely: junk dropped, duplicates removed, caps enforced', () => {
    expect(parseCardOrder(null)).toEqual({});
    expect(parseCardOrder([])).toEqual({});
    expect(
      parseCardOrder({ a: ['1', '1', 2, '', 'x'.repeat(65), '2'], b: 'nope', '': ['z'] }),
    ).toEqual({
      a: ['1', '2'],
    });
    expect(
      Object.keys(
        parseCardOrder(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`l${i}`, ['a']]))),
      ).length,
    ).toBe(40);
    expect(parseCardOrder({ a: Array.from({ length: 400 }, (_, i) => `i${i}`) })['a']).toHaveLength(
      300,
    );
  });
  it('is part of the options, defaults to none, and survives parsing', () => {
    expect(parseViewOptions({}).cardOrder).toEqual({});
    expect(parseViewOptions({ cardOrder: { todo: ['a', 'b'] } }).cardOrder).toEqual({
      todo: ['a', 'b'],
    });
  });
});
