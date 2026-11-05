import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { burstsOf, carouselPool, readCarousel } from './recap-carousel';
import { carouselSlides, clipSlideNumbers, flowLayouts, layoutRecap } from './recap-layout';
import { holdingPick, rankPictures, resolveRecap } from './recap-slots';

const pic = (key: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day, device: 'ILCE-7M4', ...extra });

describe('a carousel’s pictures', () => {
  it('tells bursts by device and seconds, or by Winnow’s pile', () => {
    const list = [
      pic('a1', '2026-10-02', { second: 100 }),
      pic('a2', '2026-10-02', { second: 102 }),
      pic('a3', '2026-10-02', { second: 104 }),
      pic('lone', '2026-10-02', { second: 120 }),
      pic('other', '2026-10-02', { second: 101, device: 'iPhone 15 Pro' }),
      pic('w1', '2026-10-03', { burst: 9, instance: 'nas' }),
      pic('w2', '2026-10-03', { burst: 9, instance: 'nas' }),
      // A minute alone never makes a burst.
      pic('m1', '2026-10-04', { minute: 600 }),
      pic('m2', '2026-10-04', { minute: 600 }),
    ];
    const b = burstsOf(list);
    expect(new Set(['a1', 'a2', 'a3'].map((k) => b.get(k))).size).toBe(1);
    expect(b.has('lone')).toBe(false);
    expect(b.has('other')).toBe(false);
    expect(b.get('w1')).toBe(b.get('w2'));
    expect(b.has('m1')).toBe(false);
  });

  it('keeps one frame per burst, the best or the one picked, and nothing left out', () => {
    const list = [pic('a1', '2026-10-02', { second: 100 }), pic('a2', '2026-10-02', { second: 101, stars: 4 }), pic('b', '2026-10-05')];
    const base = { left: [], bursts: true, burstPick: {} };
    expect(carouselPool(list, base, rankPictures).map((p) => p.key)).toEqual(['a2', 'b']);
    const id = burstsOf(list).get('a1')!;
    expect(carouselPool(list, { ...base, burstPick: { [id]: 'a1' } }, rankPictures).map((p) => p.key)).toEqual(['a1', 'b']);
    expect(carouselPool(list, { ...base, left: ['b'] }, rankPictures).map((p) => p.key)).toEqual(['a2']);
    expect(carouselPool(list, { ...base, bursts: false }, rankPictures)).toHaveLength(3);
  });

  it('reads untrusted settings; weeks only for a month', () => {
    expect(readCarousel(undefined, 'month').after).toBe('highlights');
    expect(readCarousel(undefined, 'grid').after).toBe('none');
    expect(readCarousel({ after: 'weeks' }, 'grid').after).toBe('none');
    const r = readCarousel({ highlights: 999, layouts: { 'p:0': 'six', 'p:1': 'nope' }, titles: 'head', left: ['a', 'a', 3] }, 'month');
    expect(r.highlights).toBe(60);
    expect(r.layouts).toEqual({ 'p:0': 'six' });
    expect(r.titles).toBe('head');
    expect(r.left).toEqual(['a']);
  });
});

describe('leaving a picture out', () => {
  it('changes its place only, the nearest in time coming in', () => {
    const list: RecapPicture[] = [];
    for (let d = 1; d <= 20; d++) list.push(pic(`d${d}`, `2026-10-${String(d).padStart(2, '0')}`, { minute: 600 }), pic(`e${d}`, `2026-10-${String(d).padStart(2, '0')}`, { minute: 900 }));
    const before = holdingPick(list, list, 8).map((p) => p.key);
    const gone = before[3];
    const after = holdingPick(list, list.filter((p) => p.key !== gone), 8).map((p) => p.key);
    expect(after).toHaveLength(8);
    expect(after.filter((k) => !before.includes(k))).toHaveLength(1);
    expect(after).not.toContain(gone);
  });
});

describe('a carousel’s slides', () => {
  const month = () => {
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    const pics: RecapPicture[] = [];
    for (let d = 1; d <= 20; d++) for (let i = 0; i < 3; i++) pics.push(pic(`p${d}-${i}`, `2026-10-${String(d).padStart(2, '0')}`, { minute: 600 + i * 60 }));
    pics.push(pic('clip', '2026-10-21', { kind: 'video' }));
    doc = withPictures(doc, pics);
    return doc;
  };

  it('lays highlights after a month’s calendar, the rhythm unless a slide is set', () => {
    const doc = month();
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    expect(layout.pages.map((p) => p.key)).toEqual(['first', 'p:0', 'p:1', 'p:2']);
    expect(flowLayouts(8).map((f) => f.layout)).toEqual(['oneTwo', 'full', 'four']);
    expect(flowLayouts(8, { 'p:0': 'six' }).map((f) => [f.layout, f.take])).toEqual([['six', 6], ['two', 2]]);
    // The clip's slide comes after the pages, and its ▶ says so.
    expect(carouselSlides(doc, r, layout).map((s) => s.key)).toEqual(['first', 'p:0', 'p:1', 'p:2', 'clip:2026-10-21']);
    expect(clipSlideNumbers(doc, r, layout).get('2026-10-21')).toBe(5);
  });

  it('follows the author’s order, and numbers the running heads in it', () => {
    let doc = month();
    doc = withRecap(doc, { carousel: { ...doc.carousel, order: ['first', 'clip:2026-10-21', 'p:2'], titles: 'head' } });
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    expect(layout.pages.map((p) => p.key)).toEqual(['first', 'p:2', 'p:0', 'p:1']);
    expect(clipSlideNumbers(doc, r, layout).get('2026-10-21')).toBe(2);
    const run = layout.pages[1].parts.find((p) => p.kind === 'text' && p.role === 'running');
    expect(run && run.kind === 'text' ? run.text : '').toMatch(/· 3\/5$/);
    expect(layout.pages[0].parts.some((p) => p.kind === 'text' && p.role === 'running')).toBe(false);
  });

  it('gives a month a slide per week when asked', () => {
    let doc = month();
    doc = withRecap(doc, { carousel: { ...doc.carousel, after: 'weeks' } });
    const layout = layoutRecap(doc, resolveRecap(doc));
    // Oct 2026 starts on a Thursday: weeks of 1–4, 5–11, 12–18, 19–25 hold pictures (21 has the clip).
    expect(layout.pages.map((p) => p.key)).toEqual(['first', 'w:0', 'w:1', 'w:2', 'w:3']);
  });
});
