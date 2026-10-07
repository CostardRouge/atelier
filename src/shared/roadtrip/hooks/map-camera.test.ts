import { describe, expect, it } from 'vitest';
import { DRIVE_DEFAULTS, applyView, drivePlan, driveRoute, viewAt, type DriveOptions } from './drive-plan';
import { driveTrack } from './drive-paint';
import type { HookDay, HookStage } from './hook-variant';
import {
  CAMERA_PRESETS,
  WIDE_SECONDS,
  cameraPresetOf,
  cameraTrack,
  flyToWidth,
  gaussianSmooth,
  kmPerPlanUnit,
  rateLimit,
  unwrapAngles,
  widestFrame,
  wholeFrame,
} from './map-camera';

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
    endDate: '2025-03-30',
    label: 'Karijini → Broome',
    places: [
      { name: 'Karijini', lat: -22.37, lon: 118.28 },
      { name: 'Broome', lat: -17.96, lon: 122.24 },
    ],
  },
];
const CAL: HookDay[] = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 2, 1 + i)).toISOString().slice(0, 10),
  dayNumber: i + 1,
  told: false,
  legStart: i === 0 || i === 10,
  pieces: [],
}));
const opts = (patch: Partial<DriveOptions> = {}): DriveOptions => ({
  ...DRIVE_DEFAULTS,
  delaySeconds: 0,
  arriveSeconds: 0,
  includePieces: false,
  driveSeconds: 6,
  camera: 'follow',
  ...patch,
});
const planOf = (o: DriveOptions) => drivePlan(driveRoute(STAGES, CAL, CAL[29].date, o), o)!;
const BOX = { width: 864, height: 600 };

describe('the arithmetic', () => {
  it('pulls back along the flyTo curve and comes back, widest in the middle of a hop', () => {
    expect(flyToWidth(100, 0, 0.5)).toBe(100);
    expect(flyToWidth(100, 1000, 0)).toBeCloseTo(100, 6);
    expect(flyToWidth(100, 1000, 1)).toBeCloseTo(100, 6);
    const mid = flyToWidth(100, 1000, 0.5);
    expect(mid).toBeGreaterThan(400);
    expect(flyToWidth(100, 1000, 0.25)).toBeLessThan(mid);
    // A hop no longer than the view barely moves it.
    expect(flyToWidth(100, 10, 0.5)).toBeLessThan(102);
  });

  it('smooths with a centred window, unwraps angles and limits a turn', () => {
    expect(gaussianSmooth([0, 0, 10, 0, 0], 0.2)).toEqual([0, 0, 10, 0, 0]);
    const blurred = gaussianSmooth([0, 0, 10, 0, 0], 1);
    expect(blurred[2]).toBeLessThan(10);
    expect(blurred[1]).toBeCloseTo(blurred[3], 9);
    expect(unwrapAngles([3, -3])[1]).toBeCloseTo(3 + (2 * Math.PI - 6), 9);
    expect(rateLimit([0, 1, 1], 0.25)).toEqual([0, 0.25, 0.5]);
  });

  it('names the preset the settings are, and nothing when they are the author’s own', () => {
    expect(cameraPresetOf({ ...DRIVE_DEFAULTS, ...CAMERA_PRESETS.navigation.values })).toBe('navigation');
    expect(cameraPresetOf({ ...DRIVE_DEFAULTS, ...CAMERA_PRESETS.calm.values, viewKm: 121 })).toBeNull();
  });
});

describe('the track', () => {
  it('is the whole route, still, when the camera does not follow', () => {
    const o = opts({ camera: 'whole' });
    const track = cameraTrack(planOf(o), o, BOX, 20);
    expect(track.at(0)).toEqual(track.whole);
    expect(track.at(3)).toEqual(track.whole);
    expect(track.whole.angle).toBe(0);
  });

  it('reads a stored share as a width, so a piece from before keeps its zoom', () => {
    const o = opts({ viewKm: null, followZoom: 0.5, smoothing: 0, lookAhead: 0, zoom: 'fixed' });
    const plan = planOf(o);
    const track = cameraTrack(plan, o, BOX, 20);
    const legacy = viewAt(plan, { x: 0, y: 0, ...BOX }, 20, o, plan.at(2));
    const tracked = viewAt(plan, { x: 0, y: 0, ...BOX }, 20, o, plan.at(2), track, 2);
    expect(tracked.scale).toBeCloseTo(legacy.scale, 6);
    // And the car is at the centre, as it always was, with nothing smoothed.
    const car = applyView(tracked, plan.at(2).point);
    expect(car.x).toBeCloseTo(BOX.width / 2, 3);
    expect(car.y).toBeCloseTo(BOX.height / 2, 3);
  });

  it('spans the asked kilometres across the box', () => {
    const o = opts({ viewKm: 200, smoothing: 0, zoom: 'fixed' });
    const plan = planOf(o);
    const track = cameraTrack(plan, o, BOX, 20);
    expect(track.viewKm).toBeCloseTo(200, 6);
    expect(track.at(2).width * kmPerPlanUnit(plan)).toBeCloseTo(200, 6);
  });

  it('pulls back in the middle of a long run and is as wide at rest', () => {
    const o = opts({ viewKm: 100, zoom: 'pull-back', pullBack: 1, smoothing: 0 });
    const plan = planOf(o);
    const track = cameraTrack(plan, o, BOX, 20);
    const run = plan.schedule.phases.find((p) => p.kind === 'run')!;
    const mid = track.at((run.start + run.end) / 2).width;
    expect(mid).toBeGreaterThan(track.at(run.start).width * 1.5);
    expect(widestFrame(track)).toBeGreaterThanOrEqual(mid * 0.95);
    const fixed = cameraTrack(plan, { ...o, zoom: 'fixed' }, BOX, 20);
    expect(fixed.at((run.start + run.end) / 2).width).toBeCloseTo(fixed.at(run.start).width, 6);
  });

  it('turns the map under heading-up so the car drives up the frame, and never while it halts', () => {
    const o = opts({ viewKm: 100, orientation: 'heading', smoothing: 0, turnSmoothing: 0.2, maxTurn: 180, openWide: false, endWide: false, secondsPerPicture: 1, pauseEverywhere: true });
    const plan = planOf(o);
    const track = cameraTrack(plan, o, BOX, 20);
    const run = plan.schedule.phases.find((p) => p.kind === 'run')!;
    const t = (run.start + run.end) / 2;
    const m = plan.at(t);
    const view = viewAt(plan, { x: 0, y: 0, ...BOX }, 20, o, m, track, t);
    // The heading, as the frame sees it, points up.
    const c = Math.cos(view.angle);
    const s = Math.sin(view.angle);
    const up = { x: m.heading.x * c - m.heading.y * s, y: m.heading.x * s + m.heading.y * c };
    expect(up.y).toBeLessThan(-0.9);
    expect(Math.abs(up.x)).toBeLessThan(0.45);
    // The car two thirds down the frame, the road ahead above it.
    const car = applyView(view, m.point);
    expect(car.y).toBeGreaterThan(BOX.height / 2);
    // A halt turns nothing.
    const halt = plan.schedule.phases.find((p) => p.kind === 'halt')!;
    expect(track.at(halt.start + 0.1).angle).toBeCloseTo(track.at(halt.end - 0.1).angle, 2);
  });

  it('never leaves the car behind, however far the look-ahead reads on a fast drive', () => {
    const o = opts({ ...CAMERA_PRESETS.navigation.values, lookAhead: 1.5, smoothing: 0, openWide: false, endWide: false, driveSeconds: 2 });
    const plan = planOf(o);
    const track = cameraTrack(plan, o, BOX, 20);
    for (let t = 0; t <= plan.seconds; t += 0.1) {
      const view = viewAt(plan, { x: 0, y: 0, ...BOX }, 20, o, plan.at(t), track, t);
      const car = applyView(view, plan.at(t).point);
      expect(car.x).toBeGreaterThan(0);
      expect(car.x).toBeLessThan(BOX.width);
      expect(car.y).toBeGreaterThan(0);
      expect(car.y).toBeLessThan(BOX.height);
    }
  });

  it('opens on the whole route and comes back to it at the end', () => {
    const o = opts({ ...CAMERA_PRESETS.calm.values, openWide: true, endWide: true });
    const plan = planOf(o);
    const track = cameraTrack(plan, o, BOX, 20);
    expect(track.at(0).width).toBeCloseTo(track.whole.width, 6);
    expect(track.at(plan.seconds).width).toBeCloseTo(track.whole.width, 3);
    expect(track.at(WIDE_SECONDS + 1).width).toBeLessThan(track.whole.width);
    const whole = wholeFrame(plan, BOX, 20);
    expect(whole).toEqual(track.whole);
  });

  it('bakes the same camera at every frame size, through the nominal frame', () => {
    const o = opts({ ...CAMERA_PRESETS.navigation.values });
    const plan = planOf(o);
    const track = driveTrack(plan, o, 9 / 16);
    const a = viewAt(plan, { x: 0, y: 0, width: 540, height: 960 }, 10, o, plan.at(2), track, 2);
    const b = viewAt(plan, { x: 0, y: 0, width: 1080, height: 1920 }, 20, o, plan.at(2), track, 2);
    expect(b.scale).toBeCloseTo(a.scale * 2, 6);
    expect(b.angle).toBeCloseTo(a.angle, 9);
  });
});
