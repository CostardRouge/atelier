import { describe, expect, it } from 'vitest';
import {
  createRecapDoc,
  localKey,
  readRecapDoc,
  winnowKey,
  withAnchor,
  withCleared,
  withPick,
  withPictures,
  withoutPictures,
  withSwap,
  type RecapPicture,
} from './recap-doc';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, ...extra });

describe('recap document', () => {
  it('starts from its template’s recipe', () => {
    const doc = createRecapDoc('month', 'local', { anchor: '2026-10-14', now: 1000 });
    expect(doc.anchor).toBe('2026-10-01');
    expect(doc.format).toBe('story');
    expect(doc.heading.text).toBe('{month}');
    const week = createRecapDoc('week', 'local', { anchor: '2026-10-29', now: 1000 });
    expect(week.anchor).toBe('2026-10-26');
    const day = createRecapDoc('onThisDay', 'local', { anchor: '2026-11-04', now: 1000 });
    expect(day.rungs).toEqual(['1y', '1m', '1w', '0d']);
    expect(day.background.kind).toBe('paper');
  });

  it('reads untrusted input without breaking', () => {
    expect(readRecapDoc(null, 'local')).toBeNull();
    expect(readRecapDoc({ id: 'x', version: 99 }, 'local')).toBeNull();
    const doc = readRecapDoc(
      {
        id: 'x',
        template: 'nope',
        format: 'huge',
        anchor: '2026-02-30',
        pictures: [
          { key: 'a', origin: 'local', name: 'a.jpg', day: '2026-10-02', stars: 9, iso: -4 },
          { key: 'a', origin: 'local', name: 'dupe' },
          { key: 'w', origin: 'winnow' },
          'junk',
        ],
        picks: { '2026-10-02': 'a', '2026-10-03': 'missing' },
        cells: { gap: 5, weekStart: 7 },
        motion: { stagger: -3, order: 'sideways' },
        background: { kind: 'video', colour: 'red', speed: 9 },
        rungs: ['1y', 'bad', '1y', '2m'],
      },
      'local',
      Date.UTC(2026, 9, 14),
    )!;
    expect(doc.template).toBe('month');
    expect(doc.format).toBe('story');
    expect(doc.anchor).toBe('2026-10-01');
    expect(doc.pictures.map((p) => p.key)).toEqual(['a']);
    expect(doc.pictures[0].stars).toBeUndefined();
    expect(doc.pictures[0].iso).toBeUndefined();
    expect(doc.picks).toEqual({ '2026-10-02': 'a' });
    expect(doc.cells.gap).toBe(0.04);
    expect(doc.cells.weekStart).toBe(1);
    expect(doc.motion.stagger).toBe(0);
    expect(doc.motion.order).toBe('wave');
    expect(doc.background.colour).toBe('#1f2a36');
    expect(doc.background.speed).toBe(2);
    expect(doc.rungs).toEqual(['1y', '2m']);
  });

  it('keeps a picture once, pins, swaps, empties and forgets', () => {
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withPictures(doc, [pic('a', '2026-10-02'), pic('b', '2026-10-03')], 2);
    doc = withPictures(doc, [pic('a', '2026-10-09')], 3);
    expect(doc.pictures).toHaveLength(2);
    doc = withPick(doc, '2026-10-02', 'a', 4);
    doc = withSwap(doc, '2026-10-02', 'a', '2026-10-03', 'b', 5);
    expect(doc.picks).toEqual({ '2026-10-02': 'b', '2026-10-03': 'a' });
    doc = withCleared(doc, '2026-10-02', 6);
    expect(doc.cleared).toEqual(['2026-10-02']);
    expect(doc.picks['2026-10-02']).toBeUndefined();
    doc = withPick(doc, '2026-10-02', 'b', 7);
    expect(doc.cleared).toEqual([]);
    doc = withoutPictures(doc, ['a'], 8);
    expect(doc.picks).toEqual({ '2026-10-02': 'b' });
    expect(doc.updatedAt).toBeGreaterThan(7);
    const moved = withAnchor(doc, '2026-11-20', 9);
    expect(moved.anchor).toBe('2026-11-01');
    expect(moved.picks).toEqual({});
  });

  it('names pictures by where they come from', () => {
    expect(winnowKey('winnow.example', 42)).toBe('w:winnow.example:42');
    expect(localKey('a.jpg', 10, 5)).toBe('l:a.jpg:10:5');
  });
});

describe('recap titles', () => {
  it('names a recap by what it is about', async () => {
    const { defaultTitle } = await import('./recap-doc');
    expect(defaultTitle(createRecapDoc('month', 'local', { anchor: '2026-10-14', now: 1 }))).toBe('October 2026');
    expect(defaultTitle(createRecapDoc('week', 'local', { anchor: '2026-10-29', now: 1 }))).toBe('Week 44, 2026');
    expect(defaultTitle(createRecapDoc('onThisDay', 'local', { anchor: '2026-11-04', now: 1 }))).toBe('On this day · 4 Nov 2026');
  });
});
