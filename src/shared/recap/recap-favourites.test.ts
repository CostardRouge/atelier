import { describe, expect, it } from 'vitest';
import { createRecapDoc, readRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { carouselReport, readCarousel } from './recap-carousel';
import { rankPictures, resolveRecap } from './recap-slots';
import { readPictureRules, rankBy } from '../sources/winnow/picture-rules';
import { flowKeys, withCount, withRemoved } from './recap-selection';

const pic = (i: number, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key: `p${i}`, origin: 'local', name: `p${i}`, kind: 'photo', day: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, minute: 600, ...extra });

describe('Winnow’s ♥ (favourites, Winnow #355)', () => {
  it('reads the ♥ on a pool picture, and ranks it before a pick and five stars', () => {
    expect(readRecapDoc({ id: 'x', template: 'dump', pictures: [{ ...pic(1), fav: true }] }, 'local')!.pictures[0].fav).toBe(true);
    const ranked = rankPictures([pic(1, { stars: 5 }), pic(2, { picked: true }), pic(3, { fav: true })]);
    expect(ranked.map((p) => p.key)).toEqual(['p3', 'p2', 'p1']);
    const order = rankBy(readPictureRules(null).prefer);
    const f = (x: Partial<{ fav: boolean; pick: boolean; stars: number }>) => ({ fav: false, pick: false, reject: false, stars: 0, edited: false, faces: 0, sharp: null, burst: null, screen: false, phash: null, folder: null, at: 0, ...x });
    expect(order(f({ fav: true }), f({ pick: true, stars: 5 }))).toBeLessThan(0);
  });

  it('puts the ♥ first in a rules list that never knew it, unless he turned it off', () => {
    expect(readPictureRules({ prefer: ['stars', 'pick'] }).prefer).toEqual(['fav', 'stars', 'pick']);
    expect(readPictureRules({ prefer: ['stars'], favOff: true })).toEqual({ leave: {}, prefer: ['stars'], favOff: true });
    expect(readPictureRules(null).prefer[0]).toBe('fav');
  });

  it('draws from the ♥ only, by itself when they fill the places, else as before', () => {
    const list = Array.from({ length: 12 }, (_, i) => pic(i, i < 3 ? { fav: true } : i < 8 ? { picked: true } : {}));
    const c = readCarousel({}, 'dump');
    expect(carouselReport(list, { ...c, picksOnly: 'favs' }, 6).pool.map((p) => p.key)).toEqual(['p0', 'p1', 'p2']);
    expect(carouselReport(list, c, 3)).toMatchObject({ favsOnly: true, favs: 3 });
    expect(carouselReport(list, c, 5)).toMatchObject({ favsOnly: false, picksOnly: true });
    expect(carouselReport(list, c, 9)).toMatchObject({ favsOnly: false, picksOnly: false });
    expect(readCarousel({ picksOnly: 'favs' }, 'dump').picksOnly).toBe('favs');
  });

  it('shows fewer places with the ♥ only rather than others, and a frozen count adds the ♥ first', () => {
    let doc = withRecap(createRecapDoc('dump', 'local', { now: 1 }), { range: { from: '2026-10-01', to: '2026-10-31' }, count: 6 });
    doc = withPictures(doc, Array.from({ length: 14 }, (_, i) => pic(i, i % 4 === 0 ? { fav: true } : {})));
    const favsOnly = withRecap(doc, { carousel: { ...doc.carousel, picksOnly: 'favs' } });
    expect(flowKeys(resolveRecap(favsOnly)).every((k) => ['p0', 'p4', 'p8', 'p12'].includes(k))).toBe(true);
    // Three places, four ♥: by itself the rule draws the ♥; one taken off, one more place brings the fourth ♥ back.
    const three = withRecap(doc, { count: 3 });
    const r = resolveRecap(three);
    expect(flowKeys(r).every((k) => three.pictures.find((p) => p.key === k)?.fav)).toBe(true);
    const frozen = withRemoved(three, r, flowKeys(r)[0], 2);
    const grown = withCount(frozen, 3, 3);
    const added = grown.carousel.chosen!.find((k) => !frozen.carousel.chosen!.includes(k))!;
    expect(grown.pictures.find((p) => p.key === added)?.fav).toBe(true);
    expect(added).not.toBe(flowKeys(r)[0]);
  });
});
