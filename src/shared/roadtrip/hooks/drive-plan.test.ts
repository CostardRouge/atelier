import { describe, expect, it } from 'vitest';
import { EASINGS } from './easing';
import type { HookDay, HookPickedPicture, HookStage } from './hook-variant';
import {
  CARD_POP_SECONDS,
  DRIVE_DEFAULTS,
  DRIVE_LIMITS,
  MAX_PICTURES_PER_STOP,
  MERGE_KM,
  PLAN_SIZE,
  REVEAL_SECONDS,
  applyView,
  buildPath,
  buildSchedule,
  cardPlacement,
  catmullRom,
  driveOptions,
  drivePlan,
  driveRoute,
  driveScore,
  driveWants,
  graticuleStep,
  headingAt,
  jitter,
  planPoints,
  pointAt,
  scaleBar,
  viewAt,
  wantsStopLabel,
  type DriveOptions,
} from './drive-plan';
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
      carColor: 'black',
      stopsOn: 'moon',
      camera: 'drone',
      picked: 'all',
      followZoom: -1,
    });
    expect(o.driveSeconds).toBe(DRIVE_LIMITS.driveSeconds.max);
    expect(o.tilt).toBe(DRIVE_LIMITS.tilt.min);
    expect(o.carColor).toBe(DRIVE_DEFAULTS.carColor);
    expect(o.stopsOn).toBe('places');
    expect(o.camera).toBe('whole');
    expect(o.picked).toEqual([]);
    expect(o.followZoom).toBe(DRIVE_LIMITS.followZoom.min);
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

describe('buildSchedule alone', () => {
  it('is empty with no stop', () => {
    const s = buildSchedule([], buildPath([], 'curved'), opts());
    expect(s.total).toBe(0);
    expect(s.phases).toEqual([]);
  });
});
