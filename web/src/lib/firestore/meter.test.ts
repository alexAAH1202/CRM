import { describe, expect, it } from 'vitest';
import { createMeter } from './meter';

describe('usage meter', () => {
  it('bills at least one read for an empty server query', () => {
    const m = createMeter();
    m.recordReads('q', 0, false, true);
    expect(m.getSnapshot().reads).toBe(1);
  });

  it('does not bill cache-served results', () => {
    const m = createMeter();
    m.recordReads('q', 25, true, true);
    m.recordListenerUpdate('l', 25, true, true);
    expect(m.getSnapshot().reads).toBe(0);
  });

  it('bills only changed docs on listener updates after the first snapshot', () => {
    const m = createMeter();
    m.recordListenerUpdate('board', 40, false, true);
    m.recordListenerUpdate('board', 2, false, false);
    m.recordListenerUpdate('board', 0, false, false);
    expect(m.getSnapshot().reads).toBe(42);
    expect(m.getSnapshot().byLabel['board']?.reads).toBe(42);
  });

  it('tracks writes, deletes and listener lifecycle per label', () => {
    const m = createMeter();
    m.recordWrites('batch', 3, 1);
    m.listenerAttached('board');
    m.listenerAttached('inbox');
    m.listenerDetached('board');
    const s = m.getSnapshot();
    expect(s.writes).toBe(3);
    expect(s.deletes).toBe(1);
    expect(s.activeListeners).toBe(1);
  });

  it('notifies subscribers and resets', () => {
    const m = createMeter();
    let calls = 0;
    const unsub = m.subscribe(() => calls++);
    m.recordWrites('x', 1, 0);
    m.reset();
    unsub();
    m.recordWrites('x', 1, 0);
    expect(calls).toBe(2);
    expect(m.getSnapshot().writes).toBe(1);
  });
});
