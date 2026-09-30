import { describe, expect, it } from 'vitest';
import { knownSubjectPoints } from './subject-known';

const isNew = (known: ReadonlyMap<string, ReadonlySet<string>>, id: string, key: string) =>
  Boolean(known.get(id) && !known.get(id)?.has(key));

describe('knownSubjectPoints', () => {
  it('records every subject layer, a pointless one included', () => {
    const known = knownSubjectPoints([{ id: 'a', keys: [] }], null, false);
    expect(known.get('a')?.size).toBe(0);
    // …so the first tap on it is new.
    expect(isNew(known, 'a', 'p1')).toBe(true);
  });

  it('keeps the first tap NEW while the model has no view yet', () => {
    // A fresh layer, then its first point — tapped before the view is made.
    const fresh = knownSubjectPoints([{ id: 'a', keys: [] }], null, false);
    const tapped = knownSubjectPoints([{ id: 'a', keys: ['p1'] }], fresh, false);
    expect(isNew(tapped, 'a', 'p1')).toBe(true);
    // Once the view exists and the mask effect has read it, it is recorded.
    const answered = knownSubjectPoints([{ id: 'a', keys: ['p1'] }], tapped, true);
    expect(isNew(answered, 'a', 'p1')).toBe(false);
  });

  it('records a tap at once when the view is already there', () => {
    const before = knownSubjectPoints([{ id: 'a', keys: ['p1'] }], null, true);
    const after = knownSubjectPoints([{ id: 'a', keys: ['p1', 'p2'] }], before, true);
    expect(after.get('a')).toEqual(new Set(['p1', 'p2']));
  });

  it('records a picture just opened whole, view or not — re-opening blinks nothing', () => {
    const opened = knownSubjectPoints([{ id: 'a', keys: ['p1', 'p2'] }], null, false);
    expect(isNew(opened, 'a', 'p1')).toBe(false);
    expect(isNew(opened, 'a', 'p2')).toBe(false);
  });

  it('forgets a point taken off while there is no view', () => {
    const before = knownSubjectPoints([{ id: 'a', keys: ['p1', 'p2'] }], null, true);
    const after = knownSubjectPoints([{ id: 'a', keys: ['p1'] }], before, false);
    expect(after.get('a')).toEqual(new Set(['p1']));
  });
});
