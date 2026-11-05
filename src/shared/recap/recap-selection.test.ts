import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { carouselReport } from './recap-carousel';
import { flowKeys, replaceCandidates, withMovedFlow, withRemoved, withReplaced, withRestored, withRuleAgain, withSwappedFlow } from './recap-selection';
import { resolveRecap } from './recap-slots';

const pic = (i: number, extra: Partial<RecapPicture> = {}): RecapPicture => ({
  key: `p${i}`,
  origin: 'winnow',
  instance: 'nas',
  asset: i,
  name: `IMG_${i}.jpg`,
  kind: 'photo',
  day: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
  minute: 600 + i,
  device: 'ILCE-7M4',
  ...extra,
});

const dump = (pics: RecapPicture[], count = 6) => {
  let doc = createRecapDoc('dump', 'local', { anchor: '2026-10-01', now: 1 });
  doc = withRecap(withPictures(doc, pics), { range: { from: '2026-10-01', to: '2026-10-31' }, count });
  return doc;
};

describe('removing a picture from a carousel', () => {
  it('shrinks it by one and freezes the selection; nothing comes in', () => {
    const doc = dump(Array.from({ length: 20 }, (_, i) => pic(i)));
    const r = resolveRecap(doc);
    const before = flowKeys(r);
    expect(before).toHaveLength(6);
    const after = withRemoved(doc, r, before[2], 2);
    const r2 = resolveRecap(after);
    expect(flowKeys(r2)).toEqual(before.filter((k) => k !== before[2]));
    expect(after.carousel.left).toEqual([before[2]]);
    // Frozen: a rule changed afterwards reshuffles nothing.
    const ruled = withRecap(after, { carousel: { ...after.carousel, rules: { leave: {}, prefer: ['stars'] } } }, 3);
    expect(flowKeys(resolveRecap(ruled))).toEqual(flowKeys(r2));
    // ↺ brings it back at its moment; «the rule again» unfreezes.
    expect(flowKeys(resolveRecap(withRestored(after, r2, before[2], 4)))).toEqual(before);
    expect(withRuleAgain(after, 5).carousel).toMatchObject({ chosen: null, left: [] });
  });

  it('replaces with one of the next best, nearest in time, never a look-alike of what stays', () => {
    const pics = Array.from({ length: 20 }, (_, i) => pic(i));
    // p30 looks like p0 (same folder, a minute apart, a bit apart): never offered while p0 stays.
    pics.push(pic(30, { day: pics[0].day, minute: 601, folder: 7, phash: '1023' }));
    pics[0] = { ...pics[0], folder: 7, phash: '1022' };
    const doc = dump(pics);
    const r = resolveRecap(doc);
    const keys = flowKeys(r);
    const aim = keys.find((k) => k !== 'p0')!;
    const offered = replaceCandidates(doc, r, aim).map((p) => p.key);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.some((k) => keys.includes(k))).toBe(false);
    if (keys.includes('p0')) expect(offered).not.toContain('p30');
    const next = withReplaced(doc, r, aim, offered[0], 2);
    const now = flowKeys(resolveRecap(next));
    expect(now).toHaveLength(6);
    expect(now).toContain(offered[0]);
    expect(now).not.toContain(aim);
  });

  it('draws from the picks only when they fill the places', () => {
    const pics = Array.from({ length: 30 }, (_, i) => pic(i, { picked: i < 8 }));
    expect(carouselReport(pics, dump(pics).carousel, 6).picksOnly).toBe(true);
    expect(carouselReport(pics, dump(pics).carousel, 12).picksOnly).toBe(false);
    expect(flowKeys(resolveRecap(dump(pics, 6))).every((k) => Number(k.slice(1)) < 8)).toBe(true);
  });

  it('leaves out look-alikes and screenshots by the shared conditions', () => {
    const pics = [pic(1, { folder: 3, phash: '255', stars: 4 }), pic(2, { folder: 3, phash: '254', minute: 602, day: pic(1).day }), pic(3, { name: 'IMG_3.png' }), pic(4, { device: undefined }), pic(5)];
    const r = carouselReport(pics, dump(pics).carousel);
    expect(r.pool.map((p) => p.key)).toEqual(['p1', 'p5']);
    expect(r.left).toEqual({ screen: 2, burst: 0, alike: 1 });
  });

  it('keeps the order he sets: a swap, then a replacement and a return in place', () => {
    const doc = dump(Array.from({ length: 20 }, (_, i) => pic(i)));
    const r = resolveRecap(doc);
    const k = flowKeys(r);
    const swapped = withSwappedFlow(doc, r, k[0], k[3], 2);
    const r2 = resolveRecap(swapped);
    expect(flowKeys(r2)).toEqual([k[3], k[1], k[2], k[0], k[4], k[5]]);
    // The slots follow: the first place shows what was the fourth.
    expect(r2.slots[0].picture?.key).toBe(k[3]);
    const by = replaceCandidates(swapped, r2, k[1])[0].key;
    const r3 = resolveRecap(withReplaced(swapped, r2, k[1], by, 3));
    expect(flowKeys(r3)).toEqual([k[3], by, k[2], k[0], k[4], k[5]]);
    const removed = withRemoved(swapped, r2, k[4], 4);
    expect(flowKeys(resolveRecap(withRestored(removed, resolveRecap(removed), k[4], 5)))).toEqual([k[3], k[1], k[2], k[0], k[4], k[5]]);
  });

  it('moves a picture between two others, the rest keeping their order', () => {
    const doc = dump(Array.from({ length: 20 }, (_, i) => pic(i)));
    const r = resolveRecap(doc);
    const k = flowKeys(r);
    expect(flowKeys(resolveRecap(withMovedFlow(doc, r, k[0], k[3], 2)))).toEqual([k[1], k[2], k[0], k[3], k[4], k[5]]);
    expect(flowKeys(resolveRecap(withMovedFlow(doc, r, k[4], k[1], 2)))).toEqual([k[0], k[4], k[1], k[2], k[3], k[5]]);
    expect(flowKeys(resolveRecap(withMovedFlow(doc, r, k[1], null, 2)))).toEqual([k[0], k[2], k[3], k[4], k[5], k[1]]);
    // Dropped where it already is: nothing changes, nothing freezes.
    expect(withMovedFlow(doc, r, k[1], k[2], 2)).toBe(doc);
  });
});

