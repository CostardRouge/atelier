import { describe, expect, it } from 'vitest';
import { createRecapDoc, withCleared, withPick, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { backgroundChoices, backgroundPicture, fillText, ownSlots, poolDevices, rankPictures, resolveRecap, spreadPick, templateDays } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });

describe('recap slots', () => {
  it('fills a month day by day, the best picture first', () => {
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withPictures(doc, [
      pic('morning', '2026-10-02', { minute: 7 * 60 }),
      pic('noon', '2026-10-02', { minute: 13 * 60 }),
      pic('star', '2026-10-03', { stars: 4 }),
      pic('plain', '2026-10-03'),
      pic('clip', '2026-10-04', { kind: 'video' }),
      pic('away', '2026-11-01'),
    ]);
    const r = resolveRecap(doc);
    expect(ownSlots(r)).toHaveLength(31);
    // Its highlights follow: what the calendar does not show.
    expect(r.slots.filter((s) => s.flow).map((s) => s.picture?.key)).toEqual(['morning', 'plain']);
    const at = (d: string) => r.slots.find((s) => s.id === d)!;
    expect(at('2026-10-02').picture?.key).toBe('noon');
    expect(at('2026-10-03').picture?.key).toBe('star');
    expect(at('2026-10-04').picture?.key).toBe('clip');
    expect(at('2026-10-05').picture).toBeNull();
    expect(r.inScope).toHaveLength(5);
    expect(r.days).toBe(3);
    expect(fillText('{month} {year} · {days} days · {count} shots · {nope}', r.vars)).toBe('October 2026 · 3 days · 5 shots · {nope}');
  });

  it('obeys a pin, an emptied day and the filter', () => {
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withPictures(doc, [pic('a', '2026-10-02', { device: 'ILCE-7M4' }), pic('b', '2026-10-02', { device: 'FC8482', stars: 5 })]);
    expect(resolveRecap(doc).slots[1].picture?.key).toBe('b');
    doc = withPick(doc, '2026-10-02', 'a');
    const pinned = resolveRecap(doc).slots[1];
    expect(pinned.picture?.key).toBe('a');
    expect(pinned.pinned).toBe(true);
    doc = withCleared(doc, '2026-10-02');
    expect(resolveRecap(doc).slots[1].picture).toBeNull();
    doc = withPick(doc, '2026-10-02', null);
    doc = withRecap(doc, { filter: { devices: ['ILCE-7M4'], kinds: 'all' } });
    expect(resolveRecap(doc).slots[1].picture?.key).toBe('a');
    expect(poolDevices(doc.pictures).map((d) => d.device)).toEqual(['FC8482', 'ILCE-7M4']);
    // A clip kept as the background only is never a day's picture, whatever its day.
    doc = withPictures(doc, [pic('sky', '2026-10-03', { kind: 'video', loose: true, stars: 5 })]);
    expect(resolveRecap(doc).slots[2].picture).toBeNull();
  });

  it('reads the steps back of on this day', () => {
    let doc = createRecapDoc('onThisDay', 'local', { anchor: '2026-11-04', now: 1 });
    doc = withPictures(doc, [pic('y', '2025-11-04'), pic('m', '2026-10-04'), pic('t', '2026-11-04')]);
    const r = resolveRecap(doc);
    expect(r.slots.map((s) => [s.label, s.day, s.picture?.key ?? null])).toEqual([
      ['1 year ago', '2025-11-04', 'y'],
      ['1 month ago', '2026-10-04', 'm'],
      ['1 week ago', '2026-10-28', null],
      ['Today', '2026-11-04', 't'],
    ]);
    expect(templateDays(doc)).toEqual(['2025-11-04', '2026-10-04', '2026-10-28', '2026-11-04']);
  });

  it('spreads a grid over its period and never shows a pinned picture twice', () => {
    let doc = createRecapDoc('grid', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withRecap(doc, { grid: '2x2', range: { from: '2026-10-01', to: '2026-10-31' } });
    const days = Array.from({ length: 20 }, (_, i) => pic(`p${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`));
    doc = withPictures(doc, [...days, pic('out', '2026-12-01')]);
    const r = resolveRecap(doc);
    expect(r.slots).toHaveLength(4);
    expect(r.slots.map((s) => s.picture?.key)).toEqual(['p2', 'p7', 'p12', 'p17']);
    doc = withPick(doc, 'n:3', 'p7');
    const keys = resolveRecap(doc).slots.map((s) => s.picture?.key);
    expect(keys.filter((k) => k === 'p7')).toHaveLength(1);
    expect(keys[3]).toBe('p7');
  });

  it('ranks Winnow’s picks and stars first, then by the middle of the day', () => {
    const list = [pic('a', 'd', { minute: 60 }), pic('b', 'd', { minute: 780 }), pic('c', 'd', { stars: 2 }), pic('p', 'd', { picked: true })];
    expect(rankPictures(list).map((p) => p.key)).toEqual(['p', 'c', 'b', 'a']);
    expect(spreadPick([pic('x', '2026-01-02'), pic('y', '2026-01-01')], 5).map((p) => p.key)).toEqual(['y', 'x']);
  });

  it('dates a single picture by its own day', () => {
    let doc = createRecapDoc('single', 'local', { anchor: '2026-11-04', now: 1 });
    doc = withRecap(doc, { range: { from: '2026-10-01', to: '2026-10-31' } });
    doc = withPictures(doc, [pic('a', '2026-10-12', { stars: 5 })]);
    expect(resolveRecap(doc).vars.date).toBe('12 October');
  });
});

describe('the blurred ground’s picture (his ask, 2026-11-06)', () => {
  it('is the best photograph of the period, his own when he chose one, any of the pool when he forces it', () => {
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withPictures(doc, [
      { key: 'a', origin: 'local', name: 'a', kind: 'photo', day: '2026-10-02' },
      { key: 'b', origin: 'local', name: 'b', kind: 'photo', day: '2026-10-09', picked: true },
      { key: 'v', origin: 'local', name: 'v', kind: 'video', day: '2026-10-10', picked: true },
      { key: 'far', origin: 'local', name: 'far', kind: 'photo', day: '2025-06-01', picked: true },
    ]);
    const r = resolveRecap(doc);
    expect(backgroundPicture(doc, r)?.key).toBe('b');
    expect(backgroundChoices(doc, r).map((p) => p.key)).toEqual(['b', 'a']);
    expect(backgroundChoices(doc, r, true).map((p) => p.key)).toContain('far');
    const own = withRecap(doc, { background: { ...doc.background, picture: 'far' } });
    expect(backgroundPicture(own, resolveRecap(own))?.key).toBe('far');
  });
});
