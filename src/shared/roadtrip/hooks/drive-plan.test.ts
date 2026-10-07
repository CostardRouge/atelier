import { describe, expect, it } from 'vitest';
import { EASINGS } from './easing';
import type { HookDay, HookPickedPicture, HookStage } from './hook-variant';
import {
  CARD_POP_SECONDS,
  DRIVE_DEFAULTS,
  DRIVE_LIMITS,
  MAX_PICTURES_PER_STOP,
  MERGE_KM,
  MIN_RUN_SECONDS,
  PLAN_SIZE,
  REVEAL_SECONDS,
  SUMMARY_SECONDS,
  applyView,
  buildPath,
  buildSchedule,
  cardPlacement,
  catmullRom,
  counterDay,
  distanceNumeral,
  driveCounterPieces,
  driveOptions,
  drivePlan,
  wakeStrength,
  driveRoute,
  driveScore,
  driveWants,
  graticuleStep,
  headingAt,
  jitter,
  planPoints,
  pointAt,
  roadMilestones,
  scaleBar,
  stagePlaceDays,
  stopClock,
  viewAt,
  wantsStopLabel,
  type DriveOptions,
  type DriveStop,
} from './drive-plan';
import { TICK_KITS } from './tick-kits';
import { driveBasemap, driveTrack } from './drive-paint';
import { groundNote, type BasemapSet } from './basemap-strip';
import { STREAM_DECODED, STRIP_TILES } from '../../map/tile-strip';
import { TILE_PX, planTiles } from '../../map/tile-math';

/** The pyramid's tiles as rasters would be described: zoom, region, size. */
const patchesOf = (set: BasemapSet) =>
  (set.pyramid?.tiles ?? []).map((t, i) => ({ zoom: t.z, box: set.pyramid!.boxes[i], width: TILE_PX, height: TILE_PX }));

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

/** A trip of `total` days starting 2025-03-01, told on the given day numbers. */
function calendar(total: number, told: number[] = [], legs: number[] = [1, 11, 16]): HookDay[] {
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(2025, 2, 1 + i));
    const isTold = told.includes(i + 1);
    return {
      date: d.toISOString().slice(0, 10),
      dayNumber: i + 1,
      told: isTold,
      legStart: legs.includes(i + 1),
      pieces: isTold
        ? [
            {
              id: `p${i + 1}`,
              title: '',
              published: false,
              media: { name: `p${i + 1}.jpg`, size: 1, lastModified: 0 },
              videoSeconds: 0,
            },
          ]
        : [],
    };
  });
}

const CAL = calendar(30);
const dateOf = (n: number) => CAL[n - 1].date;
const opts = (patch: Partial<DriveOptions> = {}): DriveOptions => ({ ...DRIVE_DEFAULTS, ...patch });
const pic = (name: string, day: number, coords?: { lat: number; lon: number }, takenAt = 0): HookPickedPicture => ({
  ref: { name, size: 1, lastModified: 0 },
  date: dateOf(day),
  takenAt,
  ...(coords ? { coords } : {}),
});

describe('driveOptions', () => {
  it('fills what a document never stored', () => {
    expect(driveOptions({})).toEqual(DRIVE_DEFAULTS);
  });

  it('clamps numbers, refuses colours it cannot paint and ids it does not know', () => {
    const o = driveOptions({
      driveSeconds: 99,
      tilt: 10,
      stopsOn: 'moon',
      camera: 'drone',
      picked: 'all',
      followZoom: -1,
    });
    expect(o.driveSeconds).toBe(DRIVE_LIMITS.driveSeconds.max);
    expect(o.tilt).toBe(DRIVE_LIMITS.tilt.min);
    expect(o.stopsOn).toBe('places');
    expect(o.camera).toBe('whole');
    expect(o.picked).toEqual([]);
    expect(o.followZoom).toBe(DRIVE_LIMITS.followZoom.min);
  });

  it('ignores the car keys a piece once carried — the car is the trip’s now', () => {
    const o = driveOptions({ carColor: '#ff0000', spare: false, rack: true, mirrors: false }) as unknown as Record<string, unknown>;
    expect(o.carColor).toBeUndefined();
    expect(o.spare).toBeUndefined();
    expect(o.rack).toBeUndefined();
    expect(o.mirrors).toBeUndefined();
  });

  it('drives the trip’s car unless the piece borrowed a vehicle, and reads that one’s paint defensively', () => {
    expect(driveOptions({}).vehicle).toBe('trip');
    expect(driveOptions({}).vehicleColor).toBe('');
    const boat = driveOptions({ vehicle: 'viper-jet', vehicleColor: '#F0BF2C' });
    expect(boat.vehicle).toBe('viper-jet');
    expect(boat.vehicleColor).toBe('#f0bf2c');
    const junk = driveOptions({ vehicle: 'titanic', vehicleColor: 'teal' });
    expect(junk.vehicle).toBe('trip');
    expect(junk.vehicleColor).toBe('');
  });

  it('reads a picked picture with its position', () => {
    const o = driveOptions({ picked: [{ ref: { name: 'a.jpg', size: 1, lastModified: 0 }, date: '2025-03-02', coords: { lat: 1, lon: 2 } }] });
    expect(o.picked[0].coords).toEqual({ lat: 1, lon: 2 });
  });
});

describe('driveRoute on places', () => {
  it('drives the trip so far and arrives at the end of this day’s leg', () => {
    const route = driveRoute(STAGES, CAL, dateOf(12), opts({ includePieces: false }));
    expect(route.stops.map((s) => s.name)).toEqual(['Perth', 'Kalbarri', 'Coral Bay']);
    expect(route.currentLeg).toBe(2);
    expect(route.stops.map((s) => s.accent)).toEqual([true, false, true]);
    expect(route.named).toBe(true);
  });

  it('drives every leg when no leg covers the day', () => {
    const route = driveRoute(STAGES, CAL, '2031-01-01', opts({ includePieces: false }));
    expect(route.stops).toHaveLength(5);
    expect(route.currentLeg).toBeNull();
  });

  it('puts a located picture at the nearest place and a dated one at its leg’s end', () => {
    const route = driveRoute(
      STAGES,
      CAL,
      dateOf(20),
      opts({
        includePieces: false,
        picked: [
          pic('near-kalbarri.jpg', 5, { lat: -27.6, lon: 114.2 }),
          pic('no-gps-leg1.jpg', 4),
          pic('no-gps-leg2.jpg', 12),
        ],
      }),
    );
    const byName = Object.fromEntries(route.stops.map((s) => [s.name, s.pictures.map((p) => p.want.ref.name)]));
    expect(byName.Kalbarri).toEqual(['no-gps-leg1.jpg', 'near-kalbarri.jpg']);
    expect(byName['Coral Bay']).toEqual(['no-gps-leg2.jpg']);
    expect(byName.Perth).toEqual([]);
  });

  it('counts what it cannot place rather than guessing a spot', () => {
    const route = driveRoute(
      STAGES,
      CAL,
      dateOf(8),
      opts({
        includePieces: false,
        picked: [pic('later.jpg', 12), pic('day1.jpg', 1), pic('no-leg.jpg', 8)],
      }),
    );
    // Day 12 is after the piece; days 1 and 8 ARE on leg 1 (days 1–10), so both land at Kalbarri, in shot order.
    expect(route.leftOut.after).toBe(1);
    expect(route.stops.find((s) => s.name === 'Kalbarri')?.pictures.map((p) => p.want.ref.name)).toEqual(['day1.jpg', 'no-leg.jpg']);
    const homeless = driveRoute(
      [{ ...STAGES[0], startDate: '2025-03-01', endDate: '2025-03-05' }],
      CAL,
      dateOf(8),
      opts({ includePieces: false, picked: [pic('no-leg.jpg', 8)] }),
    );
    expect(homeless.leftOut.homeless).toBe(1);
    const outside = driveRoute(STAGES, CAL, dateOf(8), opts({ includePieces: false, picked: [{ ...pic('x.jpg', 1), date: '2019-01-01' }] }));
    expect(outside.leftOut.outside).toBe(1);
  });

  it('rides the told days’ pictures along, at the end of their leg, once each', () => {
    const cal = calendar(30, [3, 5, 12]);
    const route = driveRoute(STAGES, cal, dateOf(20), opts({ picked: [pic('p3.jpg', 3)] }));
    const kalbarri = route.stops.find((s) => s.name === 'Kalbarri')!;
    // p3 was picked (and lands on leg 1 by its date), p5 rides along; p3 is not doubled.
    expect(kalbarri.pictures.map((p) => p.want.ref.name).sort()).toEqual(['p3.jpg', 'p5.jpg']);
    expect(route.stops.find((s) => s.name === 'Coral Bay')?.pictures.map((p) => p.want.ref.name)).toEqual(['p12.jpg']);
    const without = driveRoute(STAGES, cal, dateOf(20), opts({ includePieces: false }));
    expect(without.stops.every((s) => s.pictures.length === 0)).toBe(true);
  });

  it('never shows the pictures of days after this one, nor the piece’s own day', () => {
    const cal = calendar(30, [12, 25]);
    const route = driveRoute(STAGES, cal, dateOf(12), opts());
    expect(route.stops.flatMap((s) => s.pictures)).toHaveLength(0);
  });

  it('shows at most a handful per stop and counts the rest', () => {
    const many = Array.from({ length: MAX_PICTURES_PER_STOP + 3 }, (_, i) => pic(`k${i}.jpg`, 5, { lat: -27.7, lon: 114.2 }));
    const route = driveRoute(STAGES, CAL, dateOf(8), opts({ includePieces: false, picked: many }));
    expect(route.stops.find((s) => s.name === 'Kalbarri')?.pictures).toHaveLength(MAX_PICTURES_PER_STOP);
    expect(route.leftOut.crowded).toBe(3);
  });

  it('drops every picture when none is to be shown', () => {
    const route = driveRoute(STAGES, calendar(30, [3]), dateOf(8), opts({ pictures: 'none', picked: [pic('a.jpg', 3)] }));
    expect(route.stops.flatMap((s) => s.pictures)).toHaveLength(0);
  });
});

describe('driveRoute on pictures', () => {
  const perth = { lat: -31.95, lon: 115.86 };
  const kalbarri = { lat: -27.71, lon: 114.16 };

  it('stops once per located picture in shot order, a run within a stone’s throw joining one stop', () => {
    const route = driveRoute(
      STAGES,
      CAL,
      dateOf(10),
      opts({
        stopsOn: 'pictures',
        picked: [
          pic('b.jpg', 2, kalbarri, 20),
          pic('a.jpg', 2, perth, 10),
          pic('a2.jpg', 2, { lat: perth.lat + 0.0005, lon: perth.lon }, 11),
          pic('c.jpg', 4, { lat: -25, lon: 114 }, 5),
        ],
      }),
    );
    expect(route.stops.map((s) => s.pictures.map((p) => p.want.ref.name))).toEqual([['a.jpg', 'a2.jpg'], ['b.jpg'], ['c.jpg']]);
    expect(route.stops.map((s) => s.name)).toEqual(['Day 2', 'Day 2', 'Day 4']);
    expect(route.stops.map((s) => s.accent)).toEqual([true, false, true]);
    expect(route.stops[0].kind).toBe('picture');
    expect(route.currentLeg).toBeNull();
  });

  it('lets a picture without a position ride with the stop shot before it', () => {
    const route = driveRoute(
      STAGES,
      CAL,
      dateOf(10),
      opts({ stopsOn: 'pictures', picked: [pic('first-no-gps.jpg', 2, undefined, 1), pic('a.jpg', 2, perth, 10), pic('after.jpg', 2, undefined, 11), pic('b.jpg', 3, kalbarri, 5)] }),
    );
    expect(route.stops.map((s) => s.pictures.map((p) => p.want.ref.name))).toEqual([['first-no-gps.jpg', 'a.jpg', 'after.jpg'], ['b.jpg']]);
  });

  it('has nothing to drive when no picture is located, and says how many', () => {
    const route = driveRoute(STAGES, CAL, dateOf(10), opts({ stopsOn: 'pictures', picked: [pic('a.jpg', 2), pic('b.jpg', 3)] }));
    expect(route.stops).toHaveLength(0);
    expect(route.leftOut.unlocated).toBe(2);
  });

  it('merges by distance, not by day', () => {
    expect(MERGE_KM).toBeLessThan(1);
    const route = driveRoute(
      STAGES,
      CAL,
      dateOf(10),
      opts({ stopsOn: 'pictures', picked: [pic('a.jpg', 2, perth, 1), pic('b.jpg', 3, { lat: perth.lat + 0.0002, lon: perth.lon }, 1)] }),
    );
    expect(route.stops).toHaveLength(1);
    expect(route.stops[0].pictures).toHaveLength(2);
  });
});

describe('driveRoute on your own places', () => {
  const stop = (id: string, name: string, lat: number, lon: number, picture?: HookPickedPicture) => ({
    id,
    name,
    lat,
    lon,
    ...(picture ? { picture } : {}),
  });
  // Places no leg names: the author put them on the map.
  const MINE = [
    stop('a', 'Monkey Mia', -25.79, 113.72, pic('dolphin.jpg', 20)),
    stop('b', ' Shark Bay ', -25.93, 113.54),
    stop('c', 'Hamelin Pool', -26.4, 114.17),
  ];

  it('reads the stops and the third source from a stored record', () => {
    const o = driveOptions({ stopsOn: 'custom', stops: [...MINE, { id: 'x', name: 'nowhere' }] });
    expect(o.stopsOn).toBe('custom');
    expect(o.stops.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('drives them in the author’s order, named as written, off every leg', () => {
    const route = driveRoute(STAGES, CAL, dateOf(5), opts({ stopsOn: 'custom', stops: MINE }));
    expect(route.stops.map((s) => s.name)).toEqual(['Monkey Mia', 'Shark Bay', 'Hamelin Pool']);
    expect(route.stops.every((s) => s.leg === null)).toBe(true);
    expect(route.currentLeg).toBeNull();
    expect(route.named).toBe(true);
  });

  it('shows a stop’s own picture there, even one shot after the piece’s day', () => {
    const route = driveRoute(STAGES, CAL, dateOf(5), opts({ stopsOn: 'custom', stops: MINE }));
    expect(route.stops[0].pictures.map((p) => p.want.ref.name)).toEqual(['dolphin.jpg']);
    expect(route.leftOut.after).toBe(0);
  });

  it('puts a picked picture with a position on the nearest stop, and counts one without', () => {
    const picked = [pic('pool.jpg', 3, { lat: -26.39, lon: 114.16 }), pic('blind.jpg', 3)];
    const route = driveRoute(STAGES, CAL, dateOf(5), opts({ stopsOn: 'custom', stops: MINE, picked }));
    expect(route.stops[2].pictures.map((p) => p.want.ref.name)).toEqual(['pool.jpg']);
    expect(route.leftOut.unlocated).toBe(1);
  });

  it('shows no picture at all when the pictures are off', () => {
    const route = driveRoute(STAGES, CAL, dateOf(5), opts({ stopsOn: 'custom', stops: MINE, pictures: 'none' }));
    expect(route.stops.every((s) => s.pictures.length === 0)).toBe(true);
    expect(driveWants(route, opts({ pictures: 'none' }))).toEqual([]);
  });

  it('draws nothing with no stop', () => {
    const route = driveRoute(STAGES, CAL, dateOf(5), opts({ stopsOn: 'custom', stops: [] }));
    expect(route.stops).toEqual([]);
    expect(drivePlan(route, opts({ stopsOn: 'custom' }))).toBeNull();
  });
});

describe('driveWants', () => {
  it('asks for every picture once, whole for cards and to the frame for a fill', () => {
    const route = driveRoute(STAGES, calendar(30, [3]), dateOf(8), opts({ picked: [pic('a.jpg', 4, { lat: -27.7, lon: 114.2 })] }));
    const cards = driveWants(route, opts());
    expect(cards.map((w) => w.ref.name).sort()).toEqual(['a.jpg', 'p3.jpg']);
    expect(cards.every((w) => w.shape === 'own')).toBe(true);
    expect(driveWants(route, opts({ pictures: 'fill' })).every((w) => w.shape === 'frame')).toBe(true);
    expect(driveWants(route, opts({ pictures: 'backdrop' })).every((w) => w.shape === 'frame')).toBe(true);
    expect(driveWants(route, opts({ pictures: 'none' }))).toEqual([]);
  });
});

describe('the path', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('passes through every stop, curved or straight, and measures its length', () => {
    for (const kind of ['curved', 'straight'] as const) {
      const path = buildPath(square, kind);
      expect(path.stopS).toHaveLength(3);
      expect(path.stopS[0]).toBe(0);
      expect(path.stopS[2]).toBeCloseTo(path.length, 9);
      for (let i = 0; i < square.length; i++) {
        const p = pointAt(path, path.stopS[i]).point;
        expect(p.x).toBeCloseTo(square[i].x, 6);
        expect(p.y).toBeCloseTo(square[i].y, 6);
      }
    }
    expect(buildPath(square, 'straight').length).toBeCloseTo(200, 9);
    expect(buildPath(square, 'curved').length).toBeGreaterThan(200);
  });

  it('interpolates along a straight path by arc length', () => {
    const path = buildPath(square, 'straight');
    expect(pointAt(path, 50).point).toEqual({ x: 50, y: 0 });
    expect(pointAt(path, 150).point).toEqual({ x: 100, y: 50 });
    expect(pointAt(path, -5).point).toEqual(square[0]);
    expect(pointAt(path, 999).point).toEqual(square[2]);
  });

  it('heads along the segment, and turns across a corner instead of snapping', () => {
    const path = buildPath(square, 'straight');
    expect(headingAt(path, 20, 10)).toEqual({ x: 1, y: 0 });
    expect(headingAt(path, 150, 10)).toEqual({ x: 0, y: 1 });
    const near = headingAt(path, 97, 10);
    expect(near.x).toBeGreaterThan(0.5);
    expect(near.y).toBeGreaterThan(0.1);
    const after = headingAt(path, 103, 10);
    expect(after.y).toBeGreaterThan(0.5);
    expect(after.x).toBeGreaterThan(0.1);
  });

  it('is a centripetal spline: the middle of a segment sits between its ends', () => {
    const mid = catmullRom({ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, 0.5);
    expect(mid.x).toBeCloseTo(50, 6);
    expect(Math.abs(mid.y)).toBeLessThan(1e-9);
  });

  it('copes with one stop and none', () => {
    expect(buildPath([], 'curved').length).toBe(0);
    const one = buildPath([{ x: 3, y: 4 }], 'curved');
    expect(one.stopS).toEqual([0]);
    expect(pointAt(one, 5).point).toEqual({ x: 3, y: 4 });
    expect(headingAt(one, 0)).toEqual({ x: 0, y: -1 });
  });

  it('plans in a fixed box whatever the frame', () => {
    const { points } = planPoints([{ lat: -31.95, lon: 115.86 }, { lat: -17.96, lon: 122.24 }]);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(PLAN_SIZE + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(PLAN_SIZE + 1e-6);
    }
    // North is up: Broome, further north, sits higher (smaller y).
    expect(points[1].y).toBeLessThan(points[0].y);
  });
});

describe('the schedule', () => {
  const route = (o: DriveOptions, pictures: HookPickedPicture[] = []) =>
    driveRoute(STAGES, CAL, dateOf(20), { ...o, includePieces: false, picked: pictures });

  it('holds, runs through stops that do not halt, halts where there are pictures, arrives, reveals', () => {
    const o = opts({ delaySeconds: 0.5, driveSeconds: 4, secondsPerPicture: 1, arriveSeconds: 0.5 });
    const r = route(o, [pic('cb.jpg', 12, { lat: -23.14, lon: 113.77 })]);
    const plan = drivePlan(r, o)!;
    const kinds = plan.schedule.phases.map((p) => p.kind);
    // Perth → Kalbarri → Coral Bay (halt, one picture) → Karijini → Broome.
    expect(kinds).toEqual(['hold', 'run', 'halt', 'run', 'arrive', 'reveal']);
    const runs = plan.schedule.phases.filter((p) => p.kind === 'run');
    expect(runs[0].end - runs[0].start + (runs[1].end - runs[1].start)).toBeCloseTo(4, 9);
    expect(plan.schedule.phases[2].end - plan.schedule.phases[2].start).toBe(1);
    expect(plan.schedule.total).toBeCloseTo(0.5 + 4 + 1 + 0.5 + REVEAL_SECONDS, 9);
    expect(plan.schedule.revealAt).toBeCloseTo(plan.schedule.total - REVEAL_SECONDS, 9);
    expect(plan.seconds).toBe(plan.schedule.total);
  });

  it('reaches every stop in order, the first at 0, and the last when it arrives', () => {
    const o = opts({ delaySeconds: 0, driveSeconds: 3, arriveSeconds: 0 });
    const plan = drivePlan(route(o), o)!;
    const { arrivals, arrivedAt } = plan.schedule;
    expect(arrivals).toHaveLength(5);
    expect(arrivals[0]).toBe(0);
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i]).toBeGreaterThan(arrivals[i - 1]);
    expect(arrivals[4]).toBeCloseTo(arrivedAt, 9);
    expect(arrivedAt).toBeCloseTo(3, 9);
  });

  it('puts the car exactly on a stop at the moment it is reached', () => {
    const o = opts({ delaySeconds: 0, driveSeconds: 3, arriveSeconds: 0, easing: 'ease-in-out' });
    const plan = drivePlan(route(o), o)!;
    plan.schedule.arrivals.forEach((at, i) => {
      const m = plan.at(at);
      expect(m.s).toBeCloseTo(plan.path.stopS[i], 6);
      expect(m.reached).toBe(i);
    });
  });

  it('gives a short run a floor, so a stop next door still reads as a drive', () => {
    const o = opts({ delaySeconds: 0, driveSeconds: 2, arriveSeconds: 0, stopsOn: 'pictures', secondsPerPicture: 0.5 });
    const r = driveRoute(
      STAGES,
      CAL,
      dateOf(20),
      {
        ...o,
        picked: [
          pic('a.jpg', 2, { lat: -31.95, lon: 115.86 }, 1),
          pic('b.jpg', 2, { lat: -31.9, lon: 115.86 }, 2),
          pic('c.jpg', 3, { lat: -20, lon: 120 }, 3),
        ],
      },
    );
    const plan = drivePlan(r, o)!;
    const runs = plan.schedule.phases.filter((p) => p.kind === 'run');
    expect(runs[0].end - runs[0].start).toBeGreaterThanOrEqual(0.35);
  });

  it('pops a stop’s pictures one beat apart and lets them leave with the car, or stay', () => {
    const o = opts({ delaySeconds: 0, driveSeconds: 2, secondsPerPicture: 0.5, arriveSeconds: 0, cardsStay: false });
    const r = route(o, [pic('cb1.jpg', 12, { lat: -23.14, lon: 113.77 }, 1), pic('cb2.jpg', 12, { lat: -23.14, lon: 113.77 }, 2)]);
    const plan = drivePlan(r, o)!;
    const halt = plan.schedule.phases.find((p) => p.kind === 'halt')!;
    expect(plan.schedule.pops.map((p) => p.at)).toEqual([halt.start, halt.start + 0.5]);
    expect(plan.showing(halt.start - 0.01)).toHaveLength(0);
    expect(plan.showing(halt.start + 0.1)[0].rise).toBeCloseTo(0.1 / CARD_POP_SECONDS, 9);
    expect(plan.showing(halt.end + 0.1)).toHaveLength(2);
    expect(plan.showing(halt.end + 0.1)[0].fade).toBeLessThan(1);
    expect(plan.showing(halt.end + 1)).toHaveLength(0);
    const stay = drivePlan(r, { ...o, cardsStay: true })!;
    expect(stay.showing(halt.end + 1)).toHaveLength(2);
  });

  it('halts nowhere without pictures unless asked to pause everywhere', () => {
    const o = opts({ delaySeconds: 0, arriveSeconds: 0 });
    expect(drivePlan(route(o), o)!.schedule.phases.filter((p) => p.kind === 'halt')).toHaveLength(0);
    const pausing = { ...o, pauseEverywhere: true, secondsPerPicture: 0.4 };
    const halts = drivePlan(route(pausing), pausing)!.schedule.phases.filter((p) => p.kind === 'halt');
    // The first stop and the three in between; the last stop's pause is the arrival.
    expect(halts).toHaveLength(4);
    expect(halts.map((h) => h.stop)).toEqual([0, 1, 2, 3]);
    expect(halts[0].end - halts[0].start).toBeCloseTo(0.4, 9);
  });

  it('fades the map away at the end on reveal, keeps it on stay, and rests past the end', () => {
    const o = opts({ delaySeconds: 0, driveSeconds: 2, arriveSeconds: 0 });
    const plan = drivePlan(route(o), o)!;
    expect(plan.at(plan.schedule.revealAt).mapAlpha).toBe(1);
    expect(plan.at(plan.schedule.revealAt + REVEAL_SECONDS / 2).mapAlpha).toBeCloseTo(0.5, 6);
    const after = plan.at(plan.schedule.total + 5);
    expect(after.over).toBe(true);
    expect(after.mapAlpha).toBe(0);
    expect(after.s).toBeCloseTo(plan.path.length, 9);
    const stay = drivePlan(route({ ...o, end: 'stay' }), { ...o, end: 'stay' })!;
    expect(stay.schedule.phases.some((p) => p.kind === 'reveal')).toBe(false);
    expect(stay.at(stay.schedule.total + 5).mapAlpha).toBe(1);
    expect(stay.at(stay.schedule.total + 5).at).toBe(4);
  });

  it('counts the kilometres the car has covered, not the road’s', () => {
    const o = opts({ delaySeconds: 0, arriveSeconds: 0 });
    const plan = drivePlan(route(o), o)!;
    expect(plan.kmAt(0)).toBe(0);
    const perthKalbarri = plan.kmAtStop[1];
    expect(perthKalbarri).toBeGreaterThan(490);
    expect(perthKalbarri).toBeLessThan(510);
    expect(plan.kmAt(plan.path.stopS[1] / 2)).toBeCloseTo(perthKalbarri / 2, 6);
    expect(plan.kmAt(plan.path.length)).toBeCloseTo(plan.kmAtStop[4], 6);
  });

  it('is nothing with no stop, or one stop and nothing to show; a parked car with pictures still plays', () => {
    const o = opts({ stopsOn: 'pictures' });
    expect(drivePlan(driveRoute(STAGES, CAL, dateOf(5), o), o)).toBeNull();
    const oneBare = { ...o, picked: [pic('a.jpg', 2, { lat: -31.95, lon: 115.86 })], pictures: 'none' as const };
    expect(drivePlan(driveRoute(STAGES, CAL, dateOf(5), oneBare), oneBare)).toBeNull();
    const oneShown = { ...o, picked: [pic('a.jpg', 2, { lat: -31.95, lon: 115.86 })] };
    const parked = drivePlan(driveRoute(STAGES, CAL, dateOf(5), oneShown), oneShown)!;
    expect(parked.seconds).toBeGreaterThan(0);
    expect(parked.schedule.phases.map((p) => p.kind)).toEqual(['hold', 'arrive', 'reveal']);
    expect(parked.schedule.pops).toHaveLength(1);
  });

  it('reads its easing off the shared table', () => {
    const o = opts({ delaySeconds: 0, driveSeconds: 2, arriveSeconds: 0, easing: 'linear' });
    const plan = drivePlan(route(o), o)!;
    expect(plan.at(1).progress).toBeCloseTo(EASINGS.linear.ease(0.5), 6);
  });
});

describe('the camera', () => {
  const o = opts({ delaySeconds: 0, arriveSeconds: 0, includePieces: false });
  const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o)!;
  const box = { x: 0, y: 100, width: 400, height: 600 };

  it('fits the whole route inside the box less the margin, whatever the moment', () => {
    const a = viewAt(plan, box, 20, { camera: 'whole', followZoom: 0.5 }, plan.at(0));
    const b = viewAt(plan, box, 20, { camera: 'whole', followZoom: 0.5 }, plan.at(2));
    expect(a).toEqual(b);
    for (const p of plan.path.points) {
      const s = applyView(a, p);
      expect(s.x).toBeGreaterThanOrEqual(box.x + 20 - 1e-6);
      expect(s.x).toBeLessThanOrEqual(box.x + box.width - 20 + 1e-6);
      expect(s.y).toBeGreaterThanOrEqual(box.y + 20 - 1e-6);
      expect(s.y).toBeLessThanOrEqual(box.y + box.height - 20 + 1e-6);
    }
  });

  it('follows the car at the box’s centre, zoomed in by the share', () => {
    const whole = viewAt(plan, box, 20, { camera: 'whole', followZoom: 0.5 }, plan.at(0));
    const m = plan.at(1.3);
    const follow = viewAt(plan, box, 20, { camera: 'follow', followZoom: 0.5 }, m);
    expect(follow.scale).toBeCloseTo(whole.scale * 2, 9);
    const car = applyView(follow, m.point);
    expect(car.x).toBeCloseTo(box.x + box.width / 2, 9);
    expect(car.y).toBeCloseTo(box.y + box.height / 2, 9);
  });
});

describe('the map’s furniture', () => {
  it('spaces the graticule so lines never crowd', () => {
    expect(graticuleStep(10, 90)).toBe(10);
    expect(graticuleStep(1000, 90)).toBe(0.1);
    expect(graticuleStep(0.001, 90)).toBe(45);
  });

  it('picks a round scale bar that fits', () => {
    // 100 px per degree of latitude ≈ 0.9 px per km: 200 km fits in 200 px, 500 does not.
    const bar = scaleBar(100, 200, 'km');
    expect(bar.value).toBe(200);
    expect(bar.px).toBeLessThanOrEqual(200);
    expect(bar.label).toBe('200 km');
    expect(scaleBar(100, 200, 'mi').label).toBe('100 mi');
    expect(scaleBar(100000, 200, 'km').label).toBe('200 m');
  });

  it('labels the ends, all, or none', () => {
    expect(wantsStopLabel('ends', 0, 5)).toBe(true);
    expect(wantsStopLabel('ends', 2, 5)).toBe(false);
    expect(wantsStopLabel('all', 2, 5)).toBe(true);
    expect(wantsStopLabel('none', 0, 5)).toBe(false);
  });

  it('places a card beside its stop, inside the frame, tilted the same way every time', () => {
    const frame = { width: 1080, height: 1920 };
    const a = cardPlacement({ x: 540, y: 960 }, 0, 'k', { w: 300, h: 200 }, frame, 60);
    const b = cardPlacement({ x: 540, y: 960 }, 0, 'k', { w: 300, h: 200 }, frame, 60);
    expect(a).toEqual(b);
    expect(a.y).toBeLessThan(960);
    const edge = cardPlacement({ x: 1075, y: 10 }, 1, 'k', { w: 300, h: 200 }, frame, 60);
    expect(edge.x + Math.hypot(300, 200) / 2).toBeLessThanOrEqual(1080);
    expect(edge.y - Math.hypot(300, 200) / 2).toBeGreaterThanOrEqual(0);
    expect(jitter('a')).toBeGreaterThanOrEqual(-1);
    expect(jitter('a')).toBeLessThanOrEqual(1);
    expect(jitter('a')).not.toBe(jitter('b'));
  });
});

describe('driveScore', () => {
  const o = opts({ delaySeconds: 0, driveSeconds: 3, arriveSeconds: 0, includePieces: false, kit: 'wood', secondsPerPicture: 0.5 });
  const r = driveRoute(STAGES, CAL, dateOf(20), { ...o, picked: [pic('cb.jpg', 12, { lat: -23.14, lon: 113.77 })] });
  const plan = drivePlan(r, o)!;

  it('ticks at every stop reached, deeper where a leg starts, the seat on arrival, a shutter per picture', () => {
    const score = driveScore(plan, o);
    const kit = TICK_KITS.wood;
    const voices = score.map((e) => e.voice);
    expect(voices.filter((v) => v === 'click')).toHaveLength(1);
    expect(voices.filter((v) => v === kit.seat)).toHaveLength(1);
    // Kalbarri (plain), Coral Bay (leg start), Karijini (leg start), Broome (seat).
    const landings = score.filter((e) => e.voice !== 'click');
    expect(landings).toHaveLength(4);
    expect(landings[0].rate).toBe(1);
    expect(landings[1].rate).toBeCloseTo(kit.leg.rate, 9);
    for (let i = 1; i < score.length; i++) expect(score[i].at).toBeGreaterThanOrEqual(score[i - 1].at);
    expect(score[score.length - 1].at).toBeCloseTo(plan.schedule.arrivedAt, 9);
  });

  it('is silent at volume 0 and without the shutter', () => {
    expect(driveScore(plan, { ...o, tickVolume: 0 })).toEqual([]);
    expect(driveScore(plan, { ...o, shutter: false }).some((e) => e.voice === 'click')).toBe(false);
  });

  it('scales every gain with the volume', () => {
    const loud = driveScore(plan, { ...o, tickVolume: 2 });
    const plain = driveScore(plan, o);
    loud.forEach((e, i) => expect(e.gain).toBeCloseTo((plain[i].gain ?? 0) * 2, 9));
  });
});

describe('the recap — the stops are dated, and the badge counts with the car', () => {
  const quiet = (patch: Partial<DriveOptions> = {}) =>
    opts({ delaySeconds: 0, arriveSeconds: 0, includePieces: false, driveSeconds: 10, ...patch });
  const WORDS = { day: 'Day', of: 'of', stop: 'Stop' };

  it('shares a leg’s span evenly among its places, a place’s own dates winning', () => {
    const dayOf = (date: string | undefined) => (date === undefined ? null : (CAL.find((d) => d.date === date)?.dayNumber ?? null));
    // Perth → Kalbarri, days 1–10: Perth 1 → 6, Kalbarri 6 → 11 (the end of day 10).
    expect(stagePlaceDays(STAGES[0], dayOf)).toEqual([
      { arrive: 1, leave: 6 },
      { arrive: 6, leave: 11 },
    ]);
    const dated: HookStage = {
      ...STAGES[0],
      places: [
        { ...STAGES[0].places[0], left: dateOf(3) },
        { ...STAGES[0].places[1], arrived: dateOf(4) },
      ],
    };
    expect(stagePlaceDays(dated, dayOf)).toEqual([
      { arrive: 1, leave: 4 },
      { arrive: 4, leave: 11 },
    ]);
    // A leg off the calendar dates nothing.
    expect(stagePlaceDays({ ...STAGES[0], startDate: '2031-01-01', endDate: '2031-01-05' }, dayOf)).toEqual([null, null]);
  });

  it('dates the legs’ stops from the legs, and counts the trip’s days', () => {
    const route = driveRoute(STAGES, CAL, dateOf(20), quiet());
    expect(route.stops.map((s) => s.days)).toEqual([
      { arrive: 1, leave: 6 },
      { arrive: 6, leave: 11 },
      { arrive: 11, leave: 16 },
      { arrive: 16, leave: 23.5 },
      { arrive: 23.5, leave: 31 },
    ]);
    expect(route.tripDays).toBe(30);
    expect(route.undated).toBe(0);
  });

  it('dates the author’s own stops from the trip place they stand on, else their picture, else not at all', () => {
    const stops = [
      { id: 'a', name: 'Perth', lat: -31.95, lon: 115.86 },
      { id: 'b', name: 'Somewhere', lat: -26, lon: 116, picture: pic('b.jpg', 8) },
      { id: 'c', name: 'Nowhere', lat: -20, lon: 118 },
    ];
    const route = driveRoute(STAGES, CAL, dateOf(20), quiet({ stopsOn: 'custom', stops }));
    expect(route.stops[0].days).toEqual({ arrive: 1, leave: 6 });
    expect(route.stops[1].days).toEqual({ arrive: 8, leave: 9 });
    expect(route.stops[2].days).toBeUndefined();
    expect(route.undated).toBe(1);
  });

  it('dates a picture stop from its pictures, the earliest to the end of the latest', () => {
    const route = driveRoute(
      STAGES,
      CAL,
      dateOf(20),
      quiet({
        stopsOn: 'pictures',
        picked: [
          pic('a.jpg', 2, { lat: -31.95, lon: 115.86 }, 1),
          pic('b.jpg', 4, { lat: -31.95, lon: 115.86 }, 2),
          pic('c.jpg', 9, { lat: -20, lon: 120 }, 3),
        ],
      }),
    );
    expect(route.stops.map((s) => s.days)).toEqual([
      { arrive: 2, leave: 5 },
      { arrive: 9, leave: 10 },
    ]);
  });

  it('places an undated stop between its dated neighbours by distance, and holds at the ends', () => {
    const stops: DriveStop[] = [
      { lat: 0, lon: 0, name: 'a', kind: 'place', leg: null, accent: true, pictures: [], days: { arrive: 1, leave: 3 } },
      { lat: 0, lon: 1, name: 'b', kind: 'place', leg: null, accent: false, pictures: [] },
      { lat: 0, lon: 3, name: 'c', kind: 'place', leg: null, accent: false, pictures: [], days: { arrive: 9, leave: 12 } },
      { lat: 0, lon: 4, name: 'd', kind: 'place', leg: null, accent: false, pictures: [] },
    ];
    const clock = stopClock(stops, [0, 100, 300, 400])!;
    expect(clock.arrive).toEqual([1, 5, 9, 12]);
    expect(clock.leave).toEqual([3, 5, 12, 12]);
    expect(stopClock(stops.map((s) => ({ ...s, days: undefined })), [0, 100, 300, 400])).toBeNull();
  });

  it('changes nothing of a drive whose badge does not follow it', () => {
    const o = quiet({ pace: 1 });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o)!;
    expect(plan.recap).toBe(false);
    expect(plan.clock).toBeNull();
    expect(plan.milestones).toEqual([]);
    expect(plan.schedule.summaryAt).toBeNull();
    expect(plan.schedule.phases.map((p) => p.kind)).toEqual(['run', 'arrive', 'reveal']);
    expect(plan.at(1).day).toBeNull();
  });

  it('on a recap, the car STAYS at a place while its days run, the road time still summing to the drive’s', () => {
    const o = quiet({ pace: 0.65 });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o, true)!;
    expect(plan.recap).toBe(true);
    const kinds = plan.schedule.phases.map((p) => p.kind);
    expect(kinds).toEqual(['stay', 'run', 'stay', 'run', 'stay', 'run', 'stay', 'run', 'arrive', 'summary', 'reveal']);
    const road = plan.schedule.phases
      .filter((p) => p.kind === 'run' || p.kind === 'stay' || p.kind === 'arrive')
      .reduce((n, p) => n + (p.end - p.start), 0);
    expect(road).toBeCloseTo(10, 6);
    expect(plan.schedule.total).toBeCloseTo(10 + SUMMARY_SECONDS + REVEAL_SECONDS, 6);
    // A run between two places that touch in time takes the floor, by length alone.
    expect(plan.schedule.phases[1].end - plan.schedule.phases[1].start).toBeGreaterThanOrEqual(MIN_RUN_SECONDS);
  });

  it('reads ONE clock: the day never goes back, starts on the first day and ends on the last', () => {
    const o = quiet({ pace: 0.65 });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o, true)!;
    let last = -Infinity;
    for (let t = 0; t <= plan.seconds; t += 0.05) {
      const day = plan.at(t).day!;
      expect(day).toBeGreaterThanOrEqual(last - 1e-9);
      last = day;
    }
    expect(plan.at(0).day).toBe(1);
    expect(plan.at(plan.schedule.summaryAt!).day).toBe(31);
    expect(plan.at(plan.seconds + 5).day).toBe(31);
    // The car stands at Kalbarri through days 6 to 10.
    const stay = plan.schedule.phases.find((p) => p.kind === 'stay' && p.stop === 1)!;
    expect(plan.at(stay.start).day).toBeCloseTo(6, 6);
    expect(plan.at(stay.end - 1e-6).day).toBeCloseTo(11, 3);
  });

  it('at the Road end of the pace the days a place took pass as the car leaves it', () => {
    const o = quiet({ pace: 0 });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o, true)!;
    expect(plan.schedule.phases.some((p) => p.kind === 'stay')).toBe(false);
    expect(plan.at(0).day).toBe(6);
    // Just short of the arrival the car is at Broome's gate: the day it reaches it.
    expect(plan.at(plan.schedule.arrivedAt - 1e-6).day).toBeCloseTo(23.5, 3);
    // The summary comes up on the trip's last day, the rest having run at the gate.
    expect(plan.at(plan.schedule.summaryAt!).day).toBe(31);
  });

  it('hands the badge its three pieces — the day, the distance or the stops — and the trip told whole past the end', () => {
    const o = quiet({ pace: 0.65 });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o, true)!;
    expect(driveCounterPieces(plan, o, 'days', 0, WORDS)).toEqual({ label: 'Day', headline: '1', headlineValue: 1, counter: 'of 30' });
    expect(driveCounterPieces(plan, o, 'days', plan.seconds + 1, WORDS)).toEqual({ label: 'Day', headline: '30', headlineValue: 30, counter: 'of 30' });
    // Under ten kilometres the numeral keeps a decimal and is no odometer's.
    expect(driveCounterPieces(plan, o, 'km', 0, WORDS)).toEqual({ label: 'km', headline: '0.0', counter: `of ${distanceNumeral(plan.kmAtStop[4], 'km')}` });
    expect(driveCounterPieces(plan, o, 'km', plan.seconds + 1, WORDS).headline).toBe(distanceNumeral(plan.kmAtStop[4], 'km'));
    expect(driveCounterPieces(plan, o, 'km', plan.seconds + 1, WORDS).headlineValue).toBe(Math.round(plan.kmAtStop[4]));
    expect(driveCounterPieces(plan, o, 'places', 0, WORDS)).toEqual({ label: 'Stop', headline: '1', headlineValue: 1, counter: 'of 5' });
    expect(driveCounterPieces(plan, o, 'places', plan.seconds + 1, WORDS).headline).toBe('5');
    expect(driveCounterPieces(plan, { ...o, distance: 'mi' }, 'km', plan.seconds + 1, WORDS).label).toBe('mi');
    expect(driveCounterPieces(plan, o, 'places', 0, { day: 'Jour', of: 'sur' }).label).toBe('Stop');
  });

  it('hands Days + km the day with the distance so far beside its total, in whole units', () => {
    const o = quiet({ pace: 0.65 });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o, true)!;
    expect(driveCounterPieces(plan, o, 'days-km', 0, WORDS)).toEqual({ label: 'Day', headline: '1', headlineValue: 1, counter: 'of 30 · 0 km' });
    const whole = Math.round(plan.kmAtStop[4]);
    const end = driveCounterPieces(plan, o, 'days-km', plan.seconds + 1, WORDS);
    expect(end).toMatchObject({ label: 'Day', headline: '30', headlineValue: 30 });
    expect(end.counter).toBe(`of 30 · ${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`);
    // The day and its value are exactly the Days mode's at every moment.
    for (const t of [0.5, plan.seconds / 3, plan.seconds / 2]) {
      const a = driveCounterPieces(plan, o, 'days', t, WORDS);
      const b = driveCounterPieces(plan, o, 'days-km', t, WORDS);
      expect([b.headline, b.headlineValue]).toEqual([a.headline, a.headlineValue]);
      expect(b.counter!.startsWith(`${a.counter} · `)).toBe(true);
    }
    expect(driveCounterPieces(plan, { ...o, distance: 'mi' }, 'days-km', plan.seconds + 1, WORDS).counter).toMatch(/ mi$/);
  });

  it('hands the odometer the value behind the numeral: the day on its continuous scale, the distance in the unit', () => {
    const o = quiet({ pace: 0.65 });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o, true)!;
    // Mid-drive the value carries the fraction the digits roll on; its floor is the headline.
    let rolled = false;
    for (let t = 0.2; t < plan.schedule.arrivedAt; t += 0.1) {
      const p = driveCounterPieces(plan, o, 'days', t, WORDS);
      expect(Math.floor(p.headlineValue! + 1e-9)).toBe(Number(p.headline));
      if (p.headlineValue! % 1 > 0.01) rolled = true;
      const km = driveCounterPieces(plan, { ...o, distance: 'mi' }, 'km', t, WORDS);
      if (km.headlineValue !== undefined) expect(Math.round(km.headlineValue)).toBe(Number(km.headline!.replace(/\s/g, '')));
    }
    expect(rolled).toBe(true);
    // At rest past the end the value is whole: the final reading does not roll.
    expect(driveCounterPieces(plan, o, 'days', plan.seconds + 1, WORDS).headlineValue! % 1).toBe(0);
  });

  it('keeps the badge’s own day when nothing dates the stops', () => {
    const stops = [
      { id: 'a', name: 'A', lat: -20, lon: 118 },
      { id: 'b', name: 'B', lat: -18, lon: 122 },
    ];
    const o = quiet({ stopsOn: 'custom', stops });
    const plan = drivePlan(driveRoute(STAGES, CAL, dateOf(20), o), o, true)!;
    expect(plan.clock).toBeNull();
    expect(driveCounterPieces(plan, o, 'days', 1, WORDS)).toEqual({});
    expect(driveCounterPieces(plan, o, 'places', 1, WORDS).counter).toBe('of 2');
    expect(plan.schedule.phases.map((p) => p.kind)).toEqual(['run', 'arrive', 'summary', 'reveal']);
  });

  it('marks the road every so many days and kilometres, a day reached during a stay sitting on its stop', () => {
    const o = quiet();
    const route = driveRoute(STAGES, CAL, dateOf(20), o);
    const plan = drivePlan(route, o, true)!;
    const marks = roadMilestones(route.stops, plan.path, plan.kmAtStop, plan.clock, 'km', 10, 1000);
    const days = marks.filter((m) => m.kind === 'day');
    expect(days.map((m) => m.value)).toEqual([10, 20, 30]);
    // Day 10 is spent at Kalbarri (6 → 11), day 20 at Karijini (16 → 23.5), day 30 at Broome.
    expect(days[0].s).toBeCloseTo(plan.path.stopS[1], 9);
    expect(days[1].s).toBeCloseTo(plan.path.stopS[3], 9);
    expect(days[2].s).toBeCloseTo(plan.path.stopS[4], 9);
    const km = marks.filter((m) => m.kind === 'distance');
    const total = plan.kmAtStop[4];
    expect(km.map((m) => m.value)).toEqual(Array.from({ length: Math.floor((total - 1e-9) / 1000) }, (_, i) => (i + 1) * 1000));
    for (const m of km) expect(plan.kmAt(m.s)).toBeCloseTo(m.value, 3);
    // Nothing at the default steps on a 30-day trip; the distance marks alone.
    expect(plan.milestones.every((m) => m.kind === 'distance')).toBe(true);
    expect(drivePlan(route, { ...o, milestones: false }, true)!.milestones).toEqual([]);
    expect(roadMilestones(route.stops, plan.path, plan.kmAtStop, plan.clock, 'off', 10, 1000).every((m) => m.kind === 'day')).toBe(true);
  });

  it('formats the numeral alone and keeps the counter inside the trip', () => {
    expect(distanceNumeral(1682.4, 'km')).toBe('1 682');
    expect(distanceNumeral(100, 'mi')).toBe('62');
    expect(distanceNumeral(3.14, 'off')).toBe('3.1');
    expect(counterDay(31, 30)).toBe(30);
    expect(counterDay(0.2, 30)).toBe(1);
    expect(counterDay(7.999, 30)).toBe(7);
  });

  it('reads the recap’s options defensively and lets a drive take a minute', () => {
    expect(driveOptions({}).pace).toBe(DRIVE_DEFAULTS.pace);
    expect(driveOptions({ pace: 4 }).pace).toBe(1);
    expect(driveOptions({ summary: false, milestones: false, plate: true })).toMatchObject({ summary: false, milestones: false, plate: true });
    expect(driveOptions({ driveSeconds: 60 }).driveSeconds).toBe(60);
    expect(driveOptions({ driveSeconds: 99 }).driveSeconds).toBe(60);
  });
});

describe('grouping nearby places (stop-clusters.ts)', () => {
  const MELBOURNE = [
    { id: 'a', name: 'Melbourne', lat: -37.81, lon: 144.96, picture: pic('a.jpg', 2) },
    { id: 'b', name: 'Fitzroy', lat: -37.8, lon: 144.98, picture: pic('b.jpg', 3) },
    { id: 'c', name: 'St Kilda', lat: -37.87, lon: 144.98 },
    { id: 'd', name: 'Geelong', lat: -38.15, lon: 144.36, picture: pic('d.jpg', 4) },
    { id: 'e', name: 'Sydney', lat: -33.87, lon: 151.21 },
  ];
  const base = opts({ stopsOn: 'custom', stops: MELBOURNE, includePieces: false });

  it('leaves the route alone when off', () => {
    const route = driveRoute(STAGES, CAL, dateOf(5), base);
    expect(route.stops.map((s) => s.name)).toEqual(['Melbourne', 'Fitzroy', 'St Kilda', 'Geelong', 'Sydney']);
    expect(route.stops.every((s) => s.members === undefined)).toBe(true);
  });

  it('folds nearby stops into one halt that holds every picture, counts its members and spans their days', () => {
    const route = driveRoute(STAGES, CAL, dateOf(5), { ...base, groupKm: 10, groupName: 'first' });
    expect(route.stops.map((s) => s.name)).toEqual(['Melbourne', 'Geelong', 'Sydney']);
    expect(route.stops[0].members).toBe(3);
    expect(route.stops[0].pictures.map((p) => p.key)).toEqual(['name:a.jpg:1', 'name:b.jpg:1']);
    expect(route.stops[0].days).toEqual({ arrive: 2, leave: 4 });
    expect(route.stops[1].members).toBeUndefined();
    // The halt sits on a real place of the list.
    expect(MELBOURNE.some((s) => s.lat === route.stops[0].lat && s.lon === route.stops[0].lon)).toBe(true);
  });

  it('names a group by the town index when it is at hand, and counts crowded pictures as one stop’s', () => {
    const towns = [{ name: 'Greater Melbourne', lat: -37.81, lon: 144.96, population: 5_000_000 }];
    const route = driveRoute(STAGES, CAL, dateOf(5), { ...base, groupKm: 10, groupName: 'town' }, undefined, towns);
    expect(route.stops[0].name).toBe('Greater Melbourne');
    const many = MELBOURNE.map((s, i) => ({ ...s, picture: pic(`m${i}.jpg`, 2) }));
    // Seven places around Melbourne with a picture each (Geelong and Sydney stay apart): one picture past what a halt shows.
    const seven = [
      ...many,
      { id: 'f', name: 'Carlton', lat: -37.8, lon: 144.97, picture: pic('f.jpg', 2) },
      { id: 'g', name: 'Richmond', lat: -37.82, lon: 145.0, picture: pic('g.jpg', 2) },
      { id: 'h', name: 'Kew', lat: -37.81, lon: 145.03, picture: pic('h.jpg', 2) },
      { id: 'i', name: 'Hawthorn', lat: -37.82, lon: 145.03, picture: pic('i.jpg', 2) },
    ];
    const crowded = driveRoute(STAGES, CAL, dateOf(5), { ...base, stops: seven, groupKm: 10, groupVisits: 'all' });
    expect(crowded.stops[0].pictures).toHaveLength(MAX_PICTURES_PER_STOP);
    expect(crowded.leftOut.crowded).toBe(1);
  });

  it('reads the options defensively', () => {
    expect(driveOptions({}).groupKm).toBe(0);
    expect(driveOptions({ groupKm: 500 }).groupKm).toBe(80);
    expect(driveOptions({ groupKm: -3 }).groupKm).toBe(0);
    expect(driveOptions({ groupVisits: 'some', groupName: 'other' })).toMatchObject({ groupVisits: 'consecutive', groupName: 'town' });
  });
});

describe('buildSchedule alone', () => {
  it('is empty with no stop', () => {
    const s = buildSchedule([], buildPath([], 'curved'), opts());
    expect(s.total).toBe(0);
    expect(s.phases).toEqual([]);
  });
});

describe('the drive’s OpenStreetMap ground', () => {
  const route = driveRoute(STAGES, CAL, dateOf(20), opts());
  const planFor = (o: DriveOptions) => drivePlan(route, o)!;
  const trackFor = (o: DriveOptions) => driveTrack(planFor(o), o, 9 / 16);

  it('is nothing unless the ground is the tiles', () => {
    expect(driveBasemap(planFor(opts()), opts(), 9 / 16)).toBeNull();
    expect(driveBasemap(planFor(opts({ ground: 'picture' })), opts({ ground: 'picture' }), 9 / 16)).toBeNull();
  });

  it('holds every stop the car drives, for the whole-route camera, and asks no strip', () => {
    const o = opts({ ground: 'tiles' });
    const want = driveBasemap(planFor(o), o, 9 / 16)!;
    for (const s of route.stops) {
      expect(s.lon).toBeGreaterThan(want.wide.box.west);
      expect(s.lon).toBeLessThan(want.wide.box.east);
      expect(s.lat).toBeGreaterThan(want.wide.box.south);
      expect(s.lat).toBeLessThan(want.wide.box.north);
    }
    expect(patchesOf(want)).toEqual([]);
    expect(want.wants).toEqual([want.wide]);
  });

  it('covers every frame a following camera shows, in more detail', () => {
    const whole = opts({ ground: 'tiles' });
    const follow = opts({ ground: 'tiles', camera: 'follow' });
    const a = driveBasemap(planFor(whole), whole, 9 / 16)!;
    const b = driveBasemap(planFor(follow), follow, 9 / 16)!;
    // The car is centred at every stop, so every stop is inside, with room.
    for (const s of route.stops) {
      expect(s.lon).toBeGreaterThan(b.wide.box.west);
      expect(s.lon).toBeLessThan(b.wide.box.east);
    }
    // Zoomed in, the same kilometre takes more pixels.
    const density = (w: typeof a) => w.wide.height / (w.wide.box.north - w.wide.box.south);
    expect(density(b)).toBeGreaterThan(density(a));
  });

  it('asks a PYRAMID of finer tiles along a tight follow, inside the budget, the wide raster first', () => {
    const o = opts({ ground: 'tiles', camera: 'follow', viewKm: 35, zoom: 'fixed', openWide: false, endWide: false });
    const plan = planFor(o);
    const want = driveBasemap(plan, o, 9 / 16, trackFor(o), 512)!;
    expect(patchesOf(want).length).toBeGreaterThan(0);
    expect(patchesOf(want).length).toBeLessThanOrEqual(512);
    expect(want.wants[0]).toBe(want.wide);
    expect(want.wants.length).toBe(2);
    expect(want.wants[1].pyramid).toBe(want.pyramid!.tiles);
    expect(want.wants[1].key).toBe(want.pyramid!.key);
    // Every tile is one tile at its own zoom, the coarse levels first.
    const zooms = patchesOf(want).map((p) => p.zoom!);
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b));
    for (const p of patchesOf(want)) expect(Math.max(p.width, p.height)).toBe(TILE_PX);
    // The tiles are DENSER than the wide raster: more pixels per degree.
    const perDeg = (w: { width: number; box: { west: number; east: number } }) => w.width / (w.box.east - w.box.west);
    expect(perDeg(patchesOf(want)[patchesOf(want).length - 1])).toBeGreaterThan(perDeg(want.wide) * 2);
    // Every stop the car halts at is under a tile — the frames are tight there.
    for (const s of route.stops) {
      expect(patchesOf(want).some((p) => s.lon >= p.box.west && s.lon <= p.box.east && s.lat >= p.box.south && s.lat <= p.box.north)).toBe(true);
    }
  });

  it('gives a pull-back its OWN zoom, never the wide raster enlarged', () => {
    // The 2026-10-07 report: zooming in and out, the ground stayed at one
    // density. A pull-back's middle now has tiles at its own, shallower zoom.
    const o = opts({ ground: 'tiles', camera: 'follow', viewKm: 120, zoom: 'pull-back', pullBack: 0.7, smoothing: 1.1, openWide: true, endWide: true });
    const plan = planFor(o);
    const track = trackFor(o);
    const set = driveBasemap(plan, o, 9 / 16, track, 100_000)!;
    expect(set.short).toBe(0);
    const levels = new Set(patchesOf(set).map((p) => p.zoom));
    expect(levels.size).toBeGreaterThanOrEqual(2);
    // The level the paint draws follows the camera: deeper where it is tight.
    const seconds = track.seconds;
    const at = (t: number) => set.levelAt(t);
    let tightest = -1;
    let widest = Infinity;
    for (let k = 0; k <= 40; k++) {
      tightest = Math.max(tightest, at((seconds * k) / 40));
      widest = Math.min(widest, at((seconds * k) / 40));
    }
    expect(tightest).toBeGreaterThan(widest);
  });

  it('says which tiles each frame draws, and a window of them nearest first', () => {
    const o = opts({ ground: 'tiles', camera: 'follow', viewKm: 35, zoom: 'fixed', openWide: false, endWide: false });
    const track = trackFor(o);
    const set = driveBasemap(planFor(o), o, 9 / 16, track, 100_000)!;
    const now = set.tilesAt(1);
    expect(now.length).toBeGreaterThan(0);
    for (const i of now) expect(set.pyramid!.tiles[i].z).toBe(set.levelAt(1));
    // A window starts with the frame at its start, and holds each tile once.
    const ahead = set.tilesAt(1, 2);
    expect(ahead.slice(0, now.length)).toEqual(now);
    expect(new Set(ahead).size).toBe(ahead.length);
    expect(ahead.length).toBeGreaterThan(now.length);
  });

  it('plans a tight follow over the whole 2 100 km fixture at FULL detail inside a computer’s fetch budget', () => {
    // What streaming buys: the pyramid is counted in REQUESTS, not bitmaps.
    const o = opts({ ground: 'tiles', camera: 'follow', viewKm: 35, zoom: 'fixed', openWide: false, endWide: false });
    const set = driveBasemap(planFor(o), o, 9 / 16, trackFor(o), STRIP_TILES)!;
    expect(set.short).toBe(0);
    expect(set.pyramid!.tiles.length).toBe(set.full);
    expect(set.full).toBeGreaterThan(STREAM_DECODED);
  });

  it('asks none without a budget, and never a tile at the wide raster’s own zoom', () => {
    const o = opts({ ground: 'tiles', camera: 'follow', viewKm: 35, zoom: 'fixed' });
    expect(patchesOf(driveBasemap(planFor(o), o, 9 / 16, trackFor(o), 0)!)).toEqual([]);
    for (const viewKm of [35, 400, 3000]) {
      const wide = opts({ ground: 'tiles', camera: 'follow', viewKm, zoom: 'fixed' });
      const b = driveBasemap(planFor(wide), wide, 9 / 16, trackFor(wide), 512)!;
      const wideZoom = planTiles(b.wide.box, b.wide.width, b.wide.height)!.z;
      for (const p of patchesOf(b)) expect(p.zoom!).toBeGreaterThan(wideZoom);
    }
  });

  it('spends a bigger budget on fewer levels given up', () => {
    const o = opts({ ground: 'tiles', camera: 'follow', viewKm: 35, zoom: 'fixed', openWide: false, endWide: false });
    const plan = planFor(o);
    const track = trackFor(o);
    const small = driveBasemap(plan, o, 9 / 16, track, 64)!;
    const big = driveBasemap(plan, o, 9 / 16, track, 4096)!;
    expect(big.short).toBeLessThan(small.short);
    expect(Math.max(...patchesOf(big).map((p) => p.zoom!))).toBeGreaterThan(Math.max(...patchesOf(small).map((p) => p.zoom!)));
  });

  it('reads a portrait frame’s delivery by its LONG edge, not its width', () => {
    // A 35 km box 864 nominal px wide on a 1080 × 1920 frame is delivered
    // 864 px wide: the level drawn is the one that density asks, not 1.78× it.
    const o = opts({ ground: 'tiles', camera: 'follow', viewKm: 35, zoom: 'fixed', smoothing: 0, openWide: false, endWide: false });
    const plan = planFor(o);
    const track = trackFor(o);
    const set = driveBasemap(plan, o, 9 / 16, track, 100_000)!;
    const degrees = track.at(1).width / (plan.geo.scale * plan.geo.k);
    const delivered = 1080 * 0.8 * o.size;
    const density = (TILE_PX * 2 ** set.levelAt(1)) / 360;
    // At least as dense as the delivery, and less than twice: the zoom it asks.
    expect(density).toBeGreaterThanOrEqual(delivered / degrees);
    expect(density).toBeLessThan((2 * delivered) / degrees);
  });

  it('says what a recorded file’s ground lost, and nothing when every tile is in', () => {
    expect(groundNote(undefined)).toBeNull();
    expect(groundNote({ problems: new Map() })).toBeNull();
    expect(groundNote({ problems: new Map([['pic', 'gone']]), coarser: 0 })).toBeNull();
    expect(groundNote({ problems: new Map([['osm:1', 'x'], ['osm:2', 'y']]) })).toMatch(/^2 map tiles could not be fetched/);
    expect(groundNote({ problems: new Map(), coarser: 3 })).toMatch(/3 came from a coarser zoom/);
  });

  it('reads the new ground and its strength', () => {
    expect(driveOptions({ ground: 'tiles' }).ground).toBe('tiles');
    expect(driveOptions({ basemapOpacity: 0 }).basemapOpacity).toBe(DRIVE_LIMITS.basemapOpacity.min);
  });
});

describe('wakeStrength', () => {
  it('leaves no wake before setting off, grows one under way, and lets it settle at a halt', () => {
    expect(wakeStrength('hold', 3)).toBe(0);
    expect(wakeStrength('run', 0)).toBe(0);
    expect(wakeStrength('run', 0.2)).toBeCloseTo(0.5, 9);
    expect(wakeStrength('run', 5)).toBe(1);
    expect(wakeStrength('halt', 0)).toBe(1);
    expect(wakeStrength('halt', 0.4)).toBeCloseTo(0.5, 9);
    expect(wakeStrength('arrive', 2)).toBe(0);
  });
});
