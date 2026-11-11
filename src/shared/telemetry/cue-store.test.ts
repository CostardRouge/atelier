import { describe, expect, it } from 'vitest';
import { createCueStore, markerAt } from './cue-store';
import type { Cue } from './srt-parser';

const cue = (i: number) => ({ frame: i, start: i, end: i + 1, timestamp: null, data: {} }) as unknown as Cue;

describe('the cue under a playing clip', () => {
  it('tells its listeners only of a change, and stops telling one that left', () => {
    const store = createCueStore();
    const heard: (number | null)[] = [];
    const leave = store.subscribe(() => heard.push(store.current?.frame ?? null));
    const a = cue(1);
    store.set(a);
    store.set(a);
    store.set(cue(2));
    store.set(null);
    leave();
    store.set(cue(3));
    expect(heard).toEqual([1, 2, null]);
    expect(store.getSnapshot()?.frame).toBe(3);
  });
});

describe('where the marker stands', () => {
  it('stands on the cue’s fix, else on the path’s start, else nowhere', () => {
    const track = [{ lat: 16, lon: -61 }] as never;
    const fixed = { start: 0, end: 1, frame: 1, timestamp: null, data: { latitude: 16.5, longitude: -61.5 } } as unknown as Cue;
    expect(markerAt(fixed, track)).toEqual([-61.5, 16.5]);
    expect(markerAt(null, track)).toEqual([-61, 16]);
    expect(markerAt(null, [])).toBeNull();
  });
});
