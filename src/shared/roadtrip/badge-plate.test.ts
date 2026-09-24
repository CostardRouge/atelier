import { describe, expect, it } from 'vitest';
import type { ExifData } from '../exif/exif-parser';
import { exposureSummary } from '../exif/exif-summary';
import type { CameraPlateSpec } from '../overlay/camera-plate';
import {
  DEFAULT_BADGE_LAYOUT,
  badgeBlockExtent,
  badgeElements,
  pieceFromElementId,
  type BadgeLayout,
} from './badge-layout';
import { DEFAULT_BADGE_WORDS, FRENCH_BADGE_WORDS, badgeContent, type BadgeOptions } from './day-badge';
import { createTripDoc, createTripPost } from './trip-types';

const SONY: ExifData = {
  make: 'SONY',
  model: 'ILCE-7CM2',
  lensModel: 'FE 24-70mm F2.8 GM II',
  focalLength: 35,
  focalLength35: 35,
  fNumber: 4,
  exposureTime: 1 / 500,
  iso: 200,
  exposureBias: -0.3,
};

const trip = () => createTripDoc('Australia', '2025-01-01', '2025-12-31');
const post = () => createTripPost('photo', '2025-03-27', 'Cliffs');
const opts = (over: Partial<BadgeOptions> = {}): BadgeOptions => ({
  mode: 'day',
  words: DEFAULT_BADGE_WORDS,
  timeAgo: 'off',
  today: '2026-01-01',
  showExif: true,
  ...over,
});
const plate = (over: Partial<CameraPlateSpec>): CameraPlateSpec => ({
  fields: ['body', 'lens', 'focal35', 'aperture', 'shutter', 'iso'],
  layout: 'tiers',
  place: 'badge',
  size: 1,
  ...over,
});
const ASPECT = 4 / 5;
const layout: BadgeLayout = DEFAULT_BADGE_LAYOUT;

describe('badgeContent — the credit read from facts', () => {
  it('draws the legacy line from the EXIF itself, with no plate', () => {
    const c = badgeContent(trip(), post(), opts({ exif: SONY }))!;
    expect(c.exif).toBe(exposureSummary(SONY));
    expect(c.plate).toBeUndefined();
  });

  it('treats a plate that is only the plain line as that line', () => {
    const c = badgeContent(
      trip(),
      post(),
      opts({ exif: SONY, camera: plate({ layout: 'line', fields: ['iso', 'aperture'] }) }),
    )!;
    expect(c.exif).toBe('ISO 200 · ƒ/4');
    expect(c.plate).toBeUndefined();
  });

  it('hands a composed plate over with its words', () => {
    const c = badgeContent(
      trip(),
      post(),
      opts({ exif: SONY, camera: plate({}), words: FRENCH_BADGE_WORDS }),
    )!;
    expect(c.plate?.spec.layout).toBe('tiers');
    expect(c.plate?.words.shotOn).toBe('Pris au');
  });

  it('says nothing over a picture that records none of the chosen facts', () => {
    const c = badgeContent(trip(), post(), opts({ exif: { iso: 100 }, camera: plate({ fields: ['lens'] }) }))!;
    expect(c.exif).toBeNull();
    expect(c.plate).toBeUndefined();
  });

  it('gives an override the last word, as the plain line', () => {
    const c = badgeContent(
      trip(),
      post(),
      opts({ exif: SONY, camera: plate({}), overrides: { exif: 'Shot on a Hasselblad' } }),
    )!;
    expect(c.exif).toBe('Shot on a Hasselblad');
    expect(c.plate).toBeUndefined();
  });

  it('renames the body from the trip’s own table', () => {
    const c = badgeContent(
      trip(),
      post(),
      opts({ exif: SONY, cameraNames: { 'SONY ILCE-7CM2': 'Sony α7C II' } }),
    )!;
    expect(c.exif?.startsWith('Sony α7C II · ')).toBe(true);
  });

  it('stays off until it is asked for', () => {
    expect(badgeContent(trip(), post(), opts({ exif: SONY, showExif: false }))!.exif).toBeNull();
  });
});

describe('badgeElements — a plate under the badge', () => {
  it('draws the plain line exactly as the legacy piece', () => {
    const legacy = badgeContent(trip(), post(), opts({ exposure: exposureSummary(SONY) }))!;
    const facts = badgeContent(trip(), post(), opts({ exif: SONY }))!;
    const strip = (els: ReturnType<typeof badgeElements>) => els.map(({ id, ...rest }) => ({ id, ...rest }));
    expect(strip(badgeElements(facts, layout, ASPECT))).toEqual(strip(badgeElements(legacy, layout, ASPECT)));
    expect(badgeBlockExtent(facts, layout, ASPECT)).toEqual(badgeBlockExtent(legacy, layout, ASPECT));
  });

  it('grows the block by the plate and keeps its bottom where the badge is anchored', () => {
    const line = badgeContent(trip(), post(), opts({ exif: SONY }))!;
    const tiers = badgeContent(trip(), post(), opts({ exif: SONY, camera: plate({}) }))!;
    const a = badgeBlockExtent(line, layout, ASPECT)!;
    const b = badgeBlockExtent(tiers, layout, ASPECT)!;
    expect(b.bottom).toBeCloseTo(a.bottom, 9);
    expect(b.top).toBeLessThan(a.top);
  });

  it('draws every run of the plate as the one Camera piece', () => {
    const c = badgeContent(trip(), post(), opts({ exif: SONY, camera: plate({}) }))!;
    const els = badgeElements(c, layout, ASPECT);
    const runs = els.filter((e) => pieceFromElementId(e.id) === 'exif');
    expect(runs.length).toBe(2);
    expect(runs.map((e) => e.id)).toEqual(['piece:exif', 'piece:exif:1']);
    // Under the rest of the block, hung from the badge's own left edge.
    const place = els.find((e) => e.id === 'piece:headline')!;
    for (const r of runs) {
      expect(r.y).toBeGreaterThan(place.y);
      expect(r.x).toBeCloseTo(layout.x, 9);
    }
  });

  it('styles the plate as the piece, keeping its pinned face', () => {
    const c = badgeContent(trip(), post(), opts({ exif: SONY, camera: plate({ layout: 'plate' }) }))!;
    const els = badgeElements(c, layout, ASPECT, { exif: { color: '#ff0000' } });
    const mono = els.filter((e) => pieceFromElementId(e.id) === 'exif' && e.fontFamily === 'JetBrains Mono');
    expect(mono.length).toBeGreaterThan(0);
    for (const e of mono) {
      expect(e.color).toBe('#ff0000');
      expect(e.styleOverrides).toEqual(expect.arrayContaining(['fontFamily', 'color']));
    }
  });
});

describe('badgeElements — a plate in a cell of its own', () => {
  it('leaves the block alone and draws the plate in its cell', () => {
    const none = badgeContent(trip(), post(), opts({ exif: SONY, showExif: false }))!;
    const own = badgeContent(trip(), post(), opts({ exif: SONY, camera: plate({ place: 'top-right' }) }))!;
    expect(badgeBlockExtent(own, layout, ASPECT)).toEqual(badgeBlockExtent(none, layout, ASPECT));
    const runs = badgeElements(own, layout, ASPECT).filter((e) => pieceFromElementId(e.id) === 'exif');
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.anchor).toBe('top-right');
      expect(r.x).toBeCloseTo(0.93, 9);
      expect(r.y).toBeLessThan(0.3);
    }
  });

  it('sends an edge bar to the frame’s bottom edge, across its width', () => {
    const c = badgeContent(trip(), post(), opts({ exif: SONY, camera: plate({ layout: 'bar' }) }))!;
    const runs = badgeElements(c, layout, ASPECT).filter((e) => pieceFromElementId(e.id) === 'exif');
    expect(runs.map((r) => r.x)).toEqual([0.05, 0.95]);
    for (const r of runs) expect(r.y).toBeGreaterThan(0.9);
  });

  it('lets the plate arrive after the block when the badge cascades', () => {
    const c = badgeContent(trip(), post(), opts({ exif: SONY, camera: plate({ place: 'top-left' }) }))!;
    const cascade = {
      step: { preset: 'fade' as const, duration: 0.5, easing: 'out' as const },
      stagger: { each: 0.1, order: 'sequence' as const },
    };
    const els = badgeElements(c, layout, ASPECT, {}, 4, cascade);
    const delay = (id: string) => els.find((e) => e.id === id)?.animation?.in?.delay ?? -1;
    const blockDelays = els.filter((e) => pieceFromElementId(e.id) !== 'exif').map((e) => delay(e.id));
    expect(delay('piece:exif')).toBeGreaterThan(Math.max(...blockDelays));
  });
});

describe('pieceFromElementId', () => {
  it("reads a plate run's id as its piece", () => {
    expect(pieceFromElementId('piece:exif:3')).toBe('exif');
    expect(pieceFromElementId('piece:headline')).toBe('headline');
    expect(pieceFromElementId('piece:nope:1')).toBeNull();
  });
});
