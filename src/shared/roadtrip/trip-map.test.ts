import { describe, expect, it } from 'vitest';
import {
  stageRoads,
  dialAngles,
  dialRadius,
  pathMidpoint,
  placeLabels,
  progressIndex,
  spreadAnchors,
  tripMap,
  wedgePath,
} from './trip-map';
import { roadLine, type RoadFix } from './road-track';
import { createTripPlace, createTripStage, type TripPlace, type TripStage } from './trip-types';

const at = (name: string, lat: number, lon: number): TripPlace => createTripPlace(name, '', { lat, lon });
const nowhere = (name: string): TripPlace => createTripPlace(name, '', null);
const stage = (start: string, end: string, places: TripPlace[], name = ''): TripStage =>
  createTripStage(name, '', start, end, places);

const PERTH = at('Perth', -31.95, 115.86);
const JURIEN = at('Jurien Bay', -30.31, 115.04);
const KALBARRI = at('Kalbarri', -27.71, 114.16);
const BROOME = at('Broome', -17.96, 122.24);
const KUNUNURRA = at('Kununurra', -15.77, 128.74);

const trip = (stages: TripStage[]) => ({ startDate: '2025-11-01', endDate: '2025-11-30', stages });

describe('pathMidpoint', () => {
  it('is the place itself for one place, and null for none', () => {
    expect(pathMidpoint([{ lat: 1, lon: 2 }])).toEqual({ lat: 1, lon: 2 });
    expect(pathMidpoint([])).toBeNull();
  });

  it('lands ON the path, halfway along its length', () => {
    // Two equal legs at the equator: halfway is the middle point.
    const mid = pathMidpoint([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
    ]);
    expect(mid!.lat).toBeCloseTo(0);
    expect(mid!.lon).toBeCloseTo(1);
    // A long leg then a short one: halfway lies on the long one.
    const onLong = pathMidpoint([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 3 },
      { lat: 1, lon: 3 },
    ]);
    expect(onLong!.lat).toBeCloseTo(0);
    expect(onLong!.lon).toBeCloseTo(2);
  });
});

describe('tripMap', () => {
  it('lists the stages in lived order with their located places and days', () => {
    const map = tripMap(
      trip([
        stage('2025-11-10', '2025-11-12', [JURIEN, KALBARRI]),
        stage('2025-11-01', '2025-11-05', [PERTH]),
      ]),
    );
    expect(map.stages.map((s) => s.label)).toEqual(['Perth', 'Jurien Bay → Kalbarri']);
    expect(map.stages[0].index).toBe(1);
    expect(map.stages[0].dates).toEqual(['2025-11-01', '2025-11-02', '2025-11-03', '2025-11-04', '2025-11-05']);
    expect(map.stages[1].anchor!.lat).toBeLessThan(-27.71);
    expect(map.stages[1].anchor!.lat).toBeGreaterThan(-30.31);
  });

  it('keeps a stage with no position on the list, with no anchor, and counts it', () => {
    const gibb = stage('2025-11-06', '2025-11-09', [nowhere('Gibb River Road')]);
    const map = tripMap(trip([stage('2025-11-01', '2025-11-05', [BROOME]), gibb, stage('2025-11-10', '2025-11-30', [KUNUNURRA])]));
    expect(map.stages).toHaveLength(3);
    expect(map.stages[1].anchor).toBeNull();
    expect(map.offMap.unplaced.map((s) => s.stage.id)).toEqual([gibb.id]);
  });

  it('dots the road across an unplaced stage or days no stage covers — and only there', () => {
    const map = tripMap(
      trip([
        stage('2025-11-01', '2025-11-05', [PERTH]),
        stage('2025-11-06', '2025-11-08', [JURIEN]),
        // 11-09 → 11-12: no stage.
        stage('2025-11-13', '2025-11-15', [KALBARRI]),
        stage('2025-11-16', '2025-11-20', [nowhere('Gibb River Road')]),
        stage('2025-11-21', '2025-11-30', [BROOME]),
      ]),
    );
    expect(map.roads.map((r) => [r.from.label, r.to.label, r.dotted, r.gapDays, r.unplaced.length])).toEqual([
      ['Perth', 'Jurien Bay', false, 0, 0],
      ['Jurien Bay', 'Kalbarri', true, 4, 0],
      ['Kalbarri', 'Broome', true, 0, 1],
    ]);
    expect(map.offMap.gapDays).toBe(4);
    expect(map.offMap.gaps.map((g) => [g.startDate, g.endDate])).toEqual([['2025-11-09', '2025-11-12']]);
  });

  it('runs a road from the last place of one stage to the first of the next', () => {
    const map = tripMap(
      trip([stage('2025-11-01', '2025-11-05', [PERTH, JURIEN]), stage('2025-11-06', '2025-11-30', [KALBARRI, BROOME])]),
    );
    expect(map.roads[0].a).toMatchObject({ name: 'Jurien Bay' });
    expect(map.roads[0].b).toMatchObject({ name: 'Kalbarri' });
  });

  it('leaves out a stage entirely outside the trip, as the ruler does', () => {
    const map = tripMap(trip([stage('2025-12-01', '2025-12-05', [PERTH]), stage('2025-11-01', '2025-11-30', [BROOME])]));
    expect(map.stages.map((s) => s.label)).toEqual(['Broome']);
  });

  it('treats a place typed by hand as a place, not a point', () => {
    const map = tripMap(trip([stage('2025-11-01', '2025-11-30', [nowhere('Somewhere'), PERTH])]));
    expect(map.stages[0].places.map((p) => p.name)).toEqual(['Perth']);
    expect(map.stages[0].anchor).toMatchObject({ lat: -31.95, lon: 115.86 });
    expect(map.offMap.unplaced).toEqual([]);
  });
});

describe('progressIndex', () => {
  const map = tripMap(
    trip([
      stage('2025-11-01', '2025-11-05', [PERTH]),
      stage('2025-11-05', '2025-11-08', [JURIEN]),
      stage('2025-11-12', '2025-11-30', [KALBARRI]),
    ]),
  );
  it('is the stage covering the day — the later one on a travel day', () => {
    expect(progressIndex(map.stages, 0)).toBe(0);
    expect(progressIndex(map.stages, 4)).toBe(1);
    expect(progressIndex(map.stages, 12)).toBe(2);
  });
  it('is the last stage ended before a day no stage covers', () => {
    expect(progressIndex(map.stages, 9)).toBe(1);
  });
});

describe('dials', () => {
  it('grows with the zoom within its bounds', () => {
    expect(dialRadius(1)).toBe(9);
    expect(dialRadius(5)).toBe(15);
    expect(dialRadius(12)).toBe(22);
  });

  it('starts at twelve o’clock and turns clockwise, one tick a day', () => {
    const angles = dialAngles(4);
    expect(angles).toHaveLength(4);
    expect(angles[0].a0).toBeCloseTo(-Math.PI / 2);
    expect(angles[1].a0).toBeCloseTo(0);
    expect(angles[3].a1).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('draws a tick as a closed annular sector', () => {
    const d = wedgePath(10, 10, 5, 10, -Math.PI / 2, 0);
    expect(d.startsWith('M10.00 0.00')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('spreadAnchors', () => {
  it('leaves anchors that are far enough apart where they are', () => {
    const out = spreadAnchors([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it('splits two stages at one place sideways, the later to the right', () => {
    const [a, b] = spreadAnchors([{ x: 50, y: 50 }, { x: 50, y: 50 }], 20);
    expect(b.x - a.x).toBeCloseTo(20);
    expect(a.y).toBeCloseTo(50);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('keeps every pair at least the minimum apart after a crowd', () => {
    const crowd = Array.from({ length: 5 }, (_, i) => ({ x: 100 + i, y: 100 + (i % 2) }));
    const out = spreadAnchors(crowd, 20, 40);
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        expect(Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y)).toBeGreaterThan(19.5);
      }
    }
  });
});

describe('placeLabels', () => {
  const view = { width: 300, height: 200 };
  it('puts a name to the right of its mark when it can', () => {
    const [box] = placeLabels([{ x: 50, y: 100, radius: 10, text: 'Perth' }], [], [], view);
    expect(box!.x).toBeGreaterThan(60);
    expect(box!.y + box!.height / 2).toBeCloseTo(100);
  });

  it('goes left when the right would leave the view, and skips a name with nowhere to go', () => {
    const [left] = placeLabels([{ x: 290, y: 100, radius: 5, text: 'Broome' }], [], [], view);
    expect(left!.x + left!.width).toBeLessThan(290);
    const walls = [{ x: 0, y: 0, width: 300, height: 200 }];
    const [none] = placeLabels([{ x: 150, y: 100, radius: 5, text: 'Cairns' }], [], walls, view);
    expect(none).toBeNull();
  });

  it('never lets two names overlap, and forces the one that must be drawn', () => {
    const boxes = placeLabels(
      [
        { x: 100, y: 100, radius: 5, text: 'Darwin → Jabiru', force: true },
        { x: 100, y: 100, radius: 5, text: 'Katherine' },
        { x: 100, y: 100, radius: 5, text: 'Kununurra' },
        { x: 100, y: 100, radius: 5, text: 'Tennant Creek' },
        { x: 100, y: 100, radius: 5, text: 'Alice Springs' },
      ],
      [],
      [],
      view,
    );
    const placed = boxes.filter((b) => b !== null);
    expect(boxes[0]).not.toBeNull();
    expect(placed.length).toBe(4);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
      }
    }
  });

  it('draws no name for an unnamed mark', () => {
    expect(placeLabels([{ x: 10, y: 10, radius: 5, text: '' }], [], [], view)).toEqual([null]);
  });
});

describe('stageRoads', () => {
  // A road round a bay (invented): A east, down, west to B; then on to C.
  const A = at('A', -30, 120);
  const B = at('B', -31, 120);
  const C = at('C', -31, 117);
  const T0 = 1_762_000_000;
  const fixes: RoadFix[] = [];
  const leg = (from: [number, number], to: [number, number], n: number) => {
    for (let i = fixes.length ? 1 : 0; i <= n; i++) {
      fixes.push({ t: T0 + fixes.length * 600, lat: from[0] + ((to[0] - from[0]) * i) / n, lon: from[1] + ((to[1] - from[1]) * i) / n });
    }
  };
  leg([-30, 120], [-30, 122], 20);
  leg([-30, 122], [-31, 122], 10);
  leg([-31, 122], [-31, 120], 20);
  leg([-31, 120], [-31, 117], 30);
  const road = roadLine(fixes, 'raw', 0);

  it('lays each stage’s path on the road between its own places', () => {
    const m = tripMap(trip([stage('2025-11-01', '2025-11-10', [A, B]), stage('2025-11-11', '2025-11-20', [C])]));
    const lines = stageRoads(m.stages, road);
    const bay = lines.get(m.stages[0].stage.id)!;
    expect(bay[0]).toEqual({ lat: -30, lon: 120 });
    expect(bay[bay.length - 1]).toEqual({ lat: -31, lon: 120 });
    // Round the bay: it reaches the far side, not across the water.
    expect(Math.max(...bay.map((p) => p.lon))).toBeCloseTo(122, 1);
    // A stage of one place has no path.
    expect(lines.has(m.stages[1].stage.id)).toBe(false);
  });

  it('keeps the straight strokes with no road', () => {
    const m = tripMap(trip([stage('2025-11-01', '2025-11-10', [A, B])]));
    expect(stageRoads(m.stages, { pieces: [], points: 0, km: 0 }).size).toBe(0);
  });
});
