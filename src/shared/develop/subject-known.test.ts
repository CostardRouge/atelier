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

  it('records the layers of a picture just MOUNTED whole — the hook starts with an empty record for it', () => {
    // `useSubjectMasks` is mounted per picture, its record made for THIS
    // picture and empty: no view yet, every point already on the picture.
    const mounted = knownSubjectPoints([{ id: 'a', keys: ['p1'] }, { id: 'b', keys: ['p2', 'p3'] }], new Map(), false);
    expect(isNew(mounted, 'a', 'p1')).toBe(false);
    expect(isNew(mounted, 'b', 'p2')).toBe(false);
    expect(isNew(mounted, 'b', 'p3')).toBe(false);
    // …and still not new once the view arrives.
    const viewed = knownSubjectPoints([{ id: 'a', keys: ['p1'] }, { id: 'b', keys: ['p2', 'p3'] }], mounted, true);
    expect(isNew(viewed, 'a', 'p1')).toBe(false);
  });

  it('records a layer brought back WITH its points whole (an undo, a paste) — it was not tapped', () => {
    const before = knownSubjectPoints([{ id: 'a', keys: [] }], null, false);
    const back = knownSubjectPoints([{ id: 'a', keys: [] }, { id: 'b', keys: ['p1'] }], before, false);
    expect(isNew(back, 'b', 'p1')).toBe(false);
    // The known layer still holds a tap back while there is no view.
    const tapped = knownSubjectPoints([{ id: 'a', keys: ['p9'] }, { id: 'b', keys: ['p1'] }], back, false);
    expect(isNew(tapped, 'a', 'p9')).toBe(true);
  });

  it('forgets a point taken off while there is no view', () => {
    const before = knownSubjectPoints([{ id: 'a', keys: ['p1', 'p2'] }], null, true);
    const after = knownSubjectPoints([{ id: 'a', keys: ['p1'] }], before, false);
    expect(after.get('a')).toEqual(new Set(['p1']));
  });
});
