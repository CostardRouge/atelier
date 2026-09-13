import { describe, expect, it } from 'vitest';
import type { HookStage } from './hook-variant';
import {
  ROUTE_DEFAULTS,
  currentLegIndex,
  drawProgress,
  drawnKm,
  fitProjection,
  formatDistance,
  futureAlphaAt,
  haversineKm,
  locatedSpots,
  penProgress,
  placeLabels,
  planarLengths,
  reachTimes,
  revealFractions,
  routeBox,
  routeOptions,
  routeScore,
  routeShape,
  routeTiming,
  segmentKms,
  wantsLabel,
} from './route-plan';
import { TICK_KITS } from './tick-kits';

/** Three legs across Western Australia; the middle one has one place only. */
const STAGES: HookStage[] = [
  {
    startDate: '2025-03-01',
    endDate: '2025-03-10',
    label: 'Perth → Kalbarri',
    places: [
      { name: 'Perth', lat: -31.95, lon: 115.86 },
      { name: 'Kalbarri', lat: -27.71, lon: 114.16 },
    ],
  },
  {
    startDate: '2025-03-11',
    endDate: '2025-03-15',
    label: 'Coral Bay',
    places: [{ name: 'Coral Bay', lat: -23.14, lon: 113.77 }],
  },
  {
    startDate: '2025-03-16',
    endDate: '2025-03-30',
    label: 'Karijini → Broome',
    places: [
      { name: 'Karijini', lat: -22.37, lon: 118.28 },
      { name: 'Broome', lat: -17.96, lon: 122.24 },
    ],
  },
];

describe('currentLegIndex', () => {
  it('finds the leg a day belongs to', () => {
    expect(currentLegIndex(STAGES, '2025-03-05')).toBe(0);
    expect(currentLegIndex(STAGES, '2025-03-20')).toBe(2);
    expect(currentLegIndex(STAGES, '2031-01-01')).toBeNull();
  });

  it('gives an overlapping travel day to the LATER leg, as stageAt does', () => {
    const overlap = [
      { ...STAGES[0], endDate: '2025-03-11' },
      STAGES[1],
    ];
    expect(currentLegIndex(overlap, '2025-03-11')).toBe(1);
  });
});

describe('routeShape', () => {
  it('joins every located place in lived order, and marks past, current and future', () => {
    const shape = routeShape(STAGES, '2025-03-12', 'trip');
    expect(shape.points.map((p) => p.point.name)).toEqual([
      'Perth',
      'Kalbarri',
      'Coral Bay',
      'Karijini',
      'Broome',
    ]);
    expect(shape.points.map((p) => p.state)).toEqual(['past', 'past', 'current', 'future', 'future']);
    expect(shape.currentLeg).toBe(2);
  });

  it('gives the segment travelling INTO a leg to the leg it arrives in', () => {
    const shape = routeShape(STAGES, '2025-03-12', 'trip');
    const intoCoralBay = shape.segments.find((s) => s.to.name === 'Coral Bay');
    expect(intoCoralBay?.from.name).toBe('Kalbarri');
    expect(intoCoralBay?.state).toBe('current');
  });

  it('rings a leg only when it IS a single place — never a point on a longer leg', () => {
    expect(routeShape(STAGES, '2025-03-12', 'trip').ring?.name).toBe('Coral Bay');
    expect(routeShape(STAGES, '2025-03-20', 'trip').ring).toBeNull();
  });

  it('draws a day outside every leg as the trip, with nothing marked', () => {
    const shape = routeShape(STAGES, '2031-01-01', 'trip');
    expect(shape.currentLeg).toBeNull();
    expect(shape.points.every((p) => p.state === 'past')).toBe(true);
  });

  it('keeps only the current leg when asked', () => {
    const shape = routeShape(STAGES, '2025-03-20', 'leg');
    expect(shape.points.map((p) => p.point.name)).toEqual(['Karijini', 'Broome']);
  });

  it('never draws a segment of zero length between two identical spots', () => {
    const doubled: HookStage[] = [
      { ...STAGES[0], places: [...STAGES[0].places, { name: 'Kalbarri again', lat: -27.71, lon: 114.16 }] },
    ];
    expect(routeShape(doubled, '2025-03-05', 'trip').segments).toHaveLength(1);
  });

  it('counts distinct located spots for the picker’s refusal', () => {
    expect(locatedSpots(STAGES)).toBe(5);
    expect(locatedSpots([{ ...STAGES[1] }])).toBe(1);
  });
});

describe('fitProjection', () => {
  const box = { x: 100, y: 200, width: 800, height: 600 };
  const points = routeShape(STAGES, '2025-03-12', 'trip').points.map((p) => p.point);

  it('keeps every point inside the box, north up', () => {
    const project = fitProjection(points, box);
    for (const p of points) {
      const at = project(p);
      expect(at.x).toBeGreaterThanOrEqual(box.x - 1e-6);
      expect(at.x).toBeLessThanOrEqual(box.x + box.width + 1e-6);
      expect(at.y).toBeGreaterThanOrEqual(box.y - 1e-6);
      expect(at.y).toBeLessThanOrEqual(box.y + box.height + 1e-6);
    }
    // Broome is north of Perth, so it is drawn higher up.
    expect(project(points[4]).y).toBeLessThan(project(points[0]).y);
  });

  it('puts a single spot in the middle rather than dividing by nothing', () => {
    const at = fitProjection([points[0]], box)(points[0]);
    expect(at).toEqual({ x: 500, y: 500 });
  });
});

describe('the pen', () => {
  it('reveals the trip so far in order, and leaves the legs ahead to fade in', () => {
    const lengths = [10, 10, 10, 10];
    const states = ['past', 'current', 'future', 'future'] as const;
    expect(revealFractions(lengths, [...states], 0)).toEqual([0, 0, 0, 0]);
    expect(revealFractions(lengths, [...states], 0.5)).toEqual([1, 0, 0, 0]);
    expect(revealFractions(lengths, [...states], 0.75)).toEqual([1, 0.5, 0, 0]);
    expect(revealFractions(lengths, [...states], 1)).toEqual([1, 1, 0, 0]);
  });

  it('eases out and arrives at its length', () => {
    expect(drawProgress(0, 2)).toBe(0);
    expect(drawProgress(2, 2)).toBe(1);
    expect(drawProgress(1, 2)).toBeGreaterThan(0.5);
    expect(drawProgress(5, 0)).toBe(1);
  });
});

describe('routeOptions', () => {
  it('fills and clamps what was stored', () => {
    expect(routeOptions({})).toEqual(ROUTE_DEFAULTS);
    const o = routeOptions({ scope: 'moon', position: 'left', size: 9, drawSeconds: -1, draw: false });
    expect(o).toEqual({ ...ROUTE_DEFAULTS, size: 1.2, draw: false, drawSeconds: 0.6 });
  });

  it('keeps a document written by the first version reading as it did', () => {
    const o = routeOptions({ scope: 'leg', position: 'bottom', size: 0.8, draw: true, drawSeconds: 2 });
    expect(o.scope).toBe('leg');
    expect(o.position).toBe('bottom');
    expect(o.align).toBe('center');
    expect(o.labels).toBe('none');
    expect(o.sound).toBe(false);
  });

  it('refuses a colour it cannot paint, an easing or a kit it does not know', () => {
    const o = routeOptions({
      currentColor: 'red',
      pastColor: '#ABCDEF',
      easing: 'bounce',
      kit: 'cowbell',
      labels: 'some',
      distance: 'furlongs',
    });
    expect(o.currentColor).toBe(ROUTE_DEFAULTS.currentColor);
    expect(o.pastColor).toBe('#abcdef');
    expect(o.easing).toBe('ease-out');
    expect(o.kit).toBe('ratchet');
    expect(o.labels).toBe('none');
    expect(o.distance).toBe('off');
  });
});

describe('routeBox', () => {
  it('keeps to the side it is asked for, and the band', () => {
    const left = routeBox(1080, 1920, 'top', 'left', 1);
    const centre = routeBox(1080, 1920, 'top', 'center', 1);
    const right = routeBox(1080, 1920, 'top', 'right', 1);
    expect(left.x).toBeLessThan(centre.x);
    expect(right.x).toBeGreaterThan(centre.x);
    expect(right.x + right.width).toBeLessThanOrEqual(1080);
    expect(routeBox(1080, 1920, 'bottom', 'center', 1).y).toBeGreaterThan(
      routeBox(1080, 1920, 'middle', 'center', 1).y,
    );
    expect(routeBox(1080, 1920, 'top', 'center', 0.5).width).toBeCloseTo(centre.width / 2);
  });
});

describe('the pen’s timing', () => {
  it('holds, then travels on the chosen curve', () => {
    expect(penProgress(0.3, 0.5, 2, 'linear')).toBe(0);
    expect(penProgress(1.5, 0.5, 2, 'linear')).toBeCloseTo(0.5);
    expect(penProgress(2.5, 0.5, 2, 'linear')).toBe(1);
    expect(penProgress(1.5, 0.5, 2, 'ease-out')).toBeGreaterThan(0.5);
    expect(penProgress(9, 0, 0, 'ease-in')).toBe(1);
  });

  it('reaches each drawn place when its segment is complete, and a leg ahead never', () => {
    const lengths = [10, 10, 10, 10];
    const states = ['past', 'current', 'future', 'future'] as const;
    expect(reachTimes(lengths, [...states], 'linear', 0.5, 2)).toEqual([0.5, 1.5, 2.5, null, null]);
    const eased = reachTimes(lengths, [...states], 'ease-out', 0, 2);
    expect(eased[0]).toBe(0);
    expect(eased[2]).toBeCloseTo(2);
    // Under ease-out the first half is drawn quickly, so its place is reached early.
    expect(eased[1] as number).toBeLessThan(1);
    expect(eased[3]).toBeNull();
  });

  it('occupies the hold, the run and the fade of the legs ahead', () => {
    const o = { ...ROUTE_DEFAULTS, delaySeconds: 0.5, drawSeconds: 2 };
    expect(routeTiming(o, true).total).toBeCloseTo(0.5 + 2 * 1.15);
    expect(routeTiming(o, false).total).toBeCloseTo(2.5);
    expect(routeTiming({ ...o, futureReveal: 'always' }, true).total).toBeCloseTo(2.5);
    expect(routeTiming({ ...o, futureStyle: 'hidden' }, true).total).toBeCloseTo(2.5);
    expect(routeTiming({ ...o, draw: false }, true).total).toBe(0);
  });

  it('lets the legs ahead in after the pen, or from the first frame', () => {
    const o = { ...ROUTE_DEFAULTS, drawSeconds: 2 };
    const timing = routeTiming(o, true);
    expect(futureAlphaAt(o, timing, 0)).toBe(0);
    expect(futureAlphaAt(o, timing, timing.fadeAt + timing.fade)).toBeCloseTo(1);
    expect(futureAlphaAt({ ...o, futureReveal: 'always' }, timing, 0)).toBe(1);
    expect(futureAlphaAt({ ...o, draw: false }, routeTiming({ ...o, draw: false }, true), 0)).toBe(1);
  });

  it('measures the segments frame-free, in the same proportions the paint reveals', () => {
    const shape = routeShape(STAGES, '2025-03-12', 'trip');
    const lengths = planarLengths(shape);
    expect(lengths).toHaveLength(4);
    const box = { x: 0, y: 0, width: 1080, height: 700 };
    const project = fitProjection(shape.points.map((p) => p.point), box);
    const pixels = shape.segments.map((s) => {
      const a = project(s.from);
      const b = project(s.to);
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i] / lengths[0]).toBeCloseTo(pixels[i] / pixels[0], 6);
    }
  });
});

describe('the distance', () => {
  it('is the great circle — Perth to Kalbarri is about 500 km', () => {
    const km = haversineKm({ name: 'Perth', lat: -31.95, lon: 115.86 }, { name: 'Kalbarri', lat: -27.71, lon: 114.16 });
    expect(km).toBeGreaterThan(490);
    expect(km).toBeLessThan(510);
  });

  it('counts only what the pen has drawn', () => {
    const shape = routeShape(STAGES, '2025-03-12', 'trip');
    const kms = segmentKms(shape);
    expect(drawnKm(kms, [1, 0.5, 0, 0])).toBeCloseTo(kms[0] + kms[1] / 2);
    expect(drawnKm(kms, [1, 1, 1, 1])).toBeCloseTo(kms.reduce((a, b) => a + b, 0));
  });

  it('reads as a distance, not a number', () => {
    expect(formatDistance(1234.4, 'km')).toBe('1 234 km');
    expect(formatDistance(7.25, 'km')).toBe('7.3 km');
    expect(formatDistance(100, 'mi')).toBe('62 mi');
    expect(formatDistance(100, 'off')).toBe('');
  });
});

describe('the names', () => {
  it('names what the mode asks', () => {
    expect(wantsLabel('none', 0, 5, 'past')).toBe(false);
    expect(wantsLabel('all', 3, 5, 'future')).toBe(true);
    expect(wantsLabel('ends', 0, 5, 'past')).toBe(true);
    expect(wantsLabel('ends', 4, 5, 'future')).toBe(true);
    expect(wantsLabel('ends', 2, 5, 'current')).toBe(false);
    expect(wantsLabel('current', 2, 5, 'current')).toBe(true);
    expect(wantsLabel('current', 0, 5, 'past')).toBe(false);
  });

  it('drops a name that would sit on another, and keeps every name inside the frame', () => {
    const frame = { width: 400, height: 400 };
    const placed = placeLabels(
      [
        { x: 100, y: 100, name: 'Perth', wanted: true },
        { x: 104, y: 100, name: 'Fremantle', wanted: true },
        { x: 390, y: 200, name: 'Kalbarri', wanted: true },
        { x: 200, y: 300, name: 'Skipped', wanted: false },
      ],
      20,
      frame,
      5,
    );
    // Perth takes the right of its dot; Fremantle finds no side left that is free.
    expect(placed.map((l) => l.index)).toEqual([0, 2]);
    expect(placed[0].side).toBe('right');
    // Near the right edge, the name goes to the left of its dot.
    expect(placed[1].side).toBe('left');
    expect(placed[1].align).toBe('right');
  });
});

describe('routeScore', () => {
  const shape = routeShape(STAGES, '2025-03-12', 'trip');
  const times = reachTimes(planarLengths(shape), shape.segments.map((s) => s.state), 'linear', 0.2, 2);

  it('ticks at every place the pen reaches — a leg voice where a leg begins, the seat where it rests', () => {
    const score = routeScore(shape, times, { kit: 'ratchet', pitch: 1 }, 1);
    const kit = TICK_KITS.ratchet;
    expect(score.map((e) => e.voice)).toEqual([kit.leg.voice, kit.tick, kit.seat]);
    expect(score[0].at).toBe(0.2);
    expect(score[2].at).toBeCloseTo(2.2);
    // A leg ahead is never reached, so never ticks.
    expect(score).toHaveLength(3);
  });

  it('follows the pitch and the volume, and writes nothing at zero', () => {
    const loud = routeScore(shape, times, { kit: 'wood', pitch: 1.5 }, 2);
    const quiet = routeScore(shape, times, { kit: 'wood', pitch: 1.5 }, 0.5);
    expect(loud[1].gain).toBeCloseTo((quiet[1].gain ?? 0) * 4);
    expect(loud[1].rate).toBeCloseTo(1.5);
    expect(loud[0].rate).toBeCloseTo(1.5 * TICK_KITS.wood.leg.rate);
    expect(routeScore(shape, times, { kit: 'wood', pitch: 1 }, 0)).toEqual([]);
  });

  it('is silent for a route of one reached place', () => {
    expect(routeScore(shape, [0.2, null, null, null, null], { kit: 'ratchet', pitch: 1 }, 1)).toEqual([]);
  });
});
