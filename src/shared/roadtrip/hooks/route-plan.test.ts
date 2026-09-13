import { describe, expect, it } from 'vitest';
import type { HookStage } from './hook-variant';
import {
  currentLegIndex,
  drawProgress,
  fitProjection,
  locatedSpots,
  revealFractions,
  routeShape,
} from './route-plan';
import { routeOptions } from './route';

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
    expect(routeOptions({})).toEqual({ scope: 'trip', position: 'top', size: 1, draw: true, drawSeconds: 1.6 });
    const o = routeOptions({ scope: 'moon', position: 'left', size: 9, drawSeconds: -1, draw: false });
    expect(o).toEqual({ scope: 'trip', position: 'top', size: 1.2, draw: false, drawSeconds: 0.6 });
  });
});
