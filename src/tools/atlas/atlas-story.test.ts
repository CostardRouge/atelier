import { describe, expect, it } from 'vitest';
import {
  cameraHeldBy,
  countedStats,
  diveView,
  flightTime,
  INTRO_DEFAULTS,
  introLine,
  introLook,
  introTitle,
  OUTRO_DEFAULTS,
  outroLook,
  phaseAt,
  pullView,
  storyOf,
} from './atlas-story';

describe('storyOf', () => {
  it('adds the intro before the flights and the outro after, the flights untouched', () => {
    const s = storyOf(INTRO_DEFAULTS, OUTRO_DEFAULTS, 30);
    expect(s).toEqual({ intro: 4, flights: 30, outro: 4.5, total: 38.5 });
  });

  it('gives a style set to none no time at all', () => {
    const s = storyOf({ ...INTRO_DEFAULTS, style: 'none' }, { ...OUTRO_DEFAULTS, style: 'none' }, 30);
    expect(s.total).toBe(30);
    expect(flightTime(s, 12)).toBe(12);
  });
});

describe('flightTime and phaseAt', () => {
  const s = storyOf(INTRO_DEFAULTS, OUTRO_DEFAULTS, 30);
  it('holds the flights still before they start and after they end', () => {
    expect(flightTime(s, 1)).toBe(0);
    expect(flightTime(s, 14)).toBe(10);
    expect(flightTime(s, 37)).toBe(30);
  });
  it('names the span an instant is in', () => {
    expect(phaseAt(s, 1)).toBe('intro');
    expect(phaseAt(s, 20)).toBe('flights');
    expect(phaseAt(s, 35)).toBe('outro');
  });
});

describe('cameraHeldBy', () => {
  const s = storyOf(INTRO_DEFAULTS, OUTRO_DEFAULTS, 30);
  const dive = { ...INTRO_DEFAULTS, style: 'dive' as const };
  const pull = { ...OUTRO_DEFAULTS, style: 'pull' as const };
  it('holds the camera through a world dive and a pull-back, and only there', () => {
    expect(cameraHeldBy(dive, OUTRO_DEFAULTS, s, 2)).toBe('dive');
    expect(cameraHeldBy(dive, OUTRO_DEFAULTS, s, 10)).toBeNull();
    expect(cameraHeldBy(INTRO_DEFAULTS, pull, s, 36)).toBe('pull');
    expect(cameraHeldBy(INTRO_DEFAULTS, OUTRO_DEFAULTS, s, 2)).toBeNull();
    expect(cameraHeldBy(INTRO_DEFAULTS, OUTRO_DEFAULTS, s, 36)).toBeNull();
  });
});

describe('introLook', () => {
  const s = storyOf(INTRO_DEFAULTS, OUTRO_DEFAULTS, 30);

  it('opens a title card on black, the title in, the overlay away', () => {
    const at = introLook(INTRO_DEFAULTS, s, 2);
    expect(at.card).toBe(1);
    expect(at.cardColour).toBe('black');
    expect(at.title).toBe(1);
    expect(at.overlay).toBe(0);
    expect(at.dive).toBeNull();
  });

  it('fades the card into the flights by the end of the intro', () => {
    const end = introLook(INTRO_DEFAULTS, s, 4);
    expect(end.card).toBe(0);
    expect(end.title).toBe(0);
    expect(introLook(INTRO_DEFAULTS, s, 4.4).overlay).toBe(1);
  });

  it('stands on a veiled map when asked, never on a card', () => {
    const at = introLook({ ...INTRO_DEFAULTS, behind: 'map' }, s, 2);
    expect(at.card).toBe(0);
    expect(at.scrim).toBeCloseTo(0.74);
  });

  it('passes through black when asked', () => {
    const through = { ...INTRO_DEFAULTS, into: 'black' as const };
    expect(introLook(through, s, 3.5).black).toBe(1);
    expect(introLook(through, s, 3.5).card).toBe(0);
  });

  it('keeps the sticker off when it is off', () => {
    expect(introLook({ ...INTRO_DEFAULTS, sticker: false }, s, 3).sticker).toBe(0);
  });

  it('dives from the world, the pin up on the way and gone at the end', () => {
    const dive = { ...INTRO_DEFAULTS, style: 'dive' as const };
    expect(introLook(dive, s, 0).dive).toBe(0);
    expect(introLook(dive, s, 3.5).dive).toBe(1);
    expect(introLook(dive, s, 2).pin).toBe(1);
    expect(introLook(dive, s, 4).pin).toBe(0);
  });

  it('is quiet once the intro has no length', () => {
    const none = storyOf({ ...INTRO_DEFAULTS, style: 'none' }, OUTRO_DEFAULTS, 30);
    expect(introLook(INTRO_DEFAULTS, none, 0).overlay).toBe(1);
    expect(introLook(INTRO_DEFAULTS, none, 0).title).toBe(0);
  });
});

describe('outroLook', () => {
  const s = storyOf(INTRO_DEFAULTS, OUTRO_DEFAULTS, 30);
  const start = 34;

  it('stays quiet while the flights play', () => {
    expect(outroLook(OUTRO_DEFAULTS, s, 20).scrim).toBe(0);
    expect(outroLook(OUTRO_DEFAULTS, s, 20).overlay).toBe(1);
  });

  it('veils the map and counts the totals up', () => {
    const at = outroLook(OUTRO_DEFAULTS, s, start + 3);
    expect(at.scrim).toBeCloseTo(0.8);
    expect(at.overlay).toBe(0);
    expect(at.count).toBe(1);
    expect(at.totals).toBe(1);
    expect(outroLook(OUTRO_DEFAULTS, s, start + 1).count).toBeLessThan(1);
  });

  it('steps back over the network for a pull-back', () => {
    const pull = { ...OUTRO_DEFAULTS, style: 'pull' as const };
    expect(outroLook(pull, s, start + 4.5).pull).toBe(1);
    expect(outroLook(pull, s, start + 4.5).titleAt).toBe('top');
  });

  it('goes to black for a fade', () => {
    expect(outroLook({ ...OUTRO_DEFAULTS, style: 'fade' }, s, start + 4.4).black).toBe(1);
  });
});

describe('cameras', () => {
  it('dives from the world to the target, ending exactly on it', () => {
    const world = { cx: 0.5, cy: 0.5, scale: 1 };
    const target = { cx: 0.8, cy: 0.6, scale: 4096 };
    expect(diveView(world, target, 0)).toEqual(world);
    const end = diveView(world, target, 1);
    expect(end.cx).toBeCloseTo(0.8);
    expect(end.scale).toBeCloseTo(4096);
    // Halfway in log space is a 64× zoom, the place halfway from where the
    // world showed it to the middle — on screen the whole way.
    const mid = diveView(world, target, 0.5);
    expect(mid.scale).toBeCloseTo(64);
    expect((target.cx - mid.cx) * mid.scale).toBeCloseTo(0.15);
    expect((target.cy - mid.cy) * mid.scale).toBeCloseTo(0.05);
  });

  it('pulls back to a little more than half the scale', () => {
    expect(pullView({ cx: 0.1, cy: 0.2, scale: 100 }, 1).scale).toBeCloseTo(58);
  });
});

describe('texts', () => {
  it('counts every total up together', () => {
    const t = { flights: 156, places: 4, distanceKm: 412, seconds: 1000, maxAlt: 118, avgAlt: 60, avgSpeed: 8, maxSpeed: 14 };
    expect(countedStats(t, 0.5).flights).toBe(78);
    expect(countedStats(t, 0.5).distanceKm).toBe(206);
    expect(countedStats(t, 2)).toEqual(t);
  });

  it('titles the intro by the author, the overlay, then the place', () => {
    expect(introTitle({ ...INTRO_DEFAULTS, title: ' Bretagne ' }, 'Perth', 'Fremantle')).toBe('Bretagne');
    expect(introTitle(INTRO_DEFAULTS, 'Perth', 'Fremantle')).toBe('Perth');
    expect(introTitle(INTRO_DEFAULTS, '', 'Fremantle')).toBe('Fremantle');
    expect(introTitle(INTRO_DEFAULTS, '', null)).toBe('');
  });

  it('writes the second line from the flights unless the author did', () => {
    expect(introLine(INTRO_DEFAULTS, 156, '14 – 28 Aug 2026')).toBe('156 flights · 14 – 28 Aug 2026');
    expect(introLine(INTRO_DEFAULTS, 1, null)).toBe('1 flight');
    expect(introLine({ ...INTRO_DEFAULTS, line: 'Summer' }, 3, null)).toBe('Summer');
  });
});
