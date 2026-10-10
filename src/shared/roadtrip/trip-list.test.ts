import { describe, expect, it } from 'vitest';
import { tripCoverage } from './trip-coverage';
import { groupOf, tripList } from './trip-list';
import { createTripDoc, createTripPost, createTripStage, type TripDoc } from './trip-types';

function trip(): TripDoc {
  const t = createTripDoc('List', '2025-07-01', '2025-07-10');
  t.stages = [createTripStage('Bay', '', '2025-07-01', '2025-07-04'), createTripStage('West', '', '2025-07-04', '2025-07-07')];
  t.posts = [createTripPost('reel', '2025-07-02', 'a'), createTripPost('photo', '2025-07-06', 'b'), createTripPost('photo', '2025-07-06', 'c')];
  return t;
}

describe('tripList', () => {
  it('groups the days by stage in lived order, the last covering stage winning', () => {
    const t = trip();
    const groups = tripList(t, tripCoverage(t).days);
    expect(groups.map((g) => [g.stage?.name ?? null, g.from, g.to, g.days])).toEqual([
      ['Bay', '2025-07-01', '2025-07-03', 3],
      // The travel day 4 Jul sits in the stage it ended in.
      ['West', '2025-07-04', '2025-07-07', 4],
      [null, '2025-07-08', '2025-07-10', 3],
    ]);
  });

  it('gives a told day its row and folds a run of silent days into one', () => {
    const t = trip();
    const [bay, west, none] = tripList(t, tripCoverage(t).days);
    expect(bay.rows).toEqual([
      { kind: 'silence', from: '2025-07-01', to: '2025-07-01', count: 1, dayNumber: 1 },
      expect.objectContaining({ kind: 'day', date: '2025-07-02', dayNumber: 2 }),
      { kind: 'silence', from: '2025-07-03', to: '2025-07-03', count: 1, dayNumber: 3 },
    ]);
    expect(west.rows.map((r) => r.kind)).toEqual(['silence', 'day', 'silence']);
    expect(west.rows[0]).toMatchObject({ from: '2025-07-04', to: '2025-07-05', count: 2 });
    expect(west.rows[1]).toMatchObject({ kind: 'day', posts: [expect.anything(), expect.anything()] });
    expect(west.told).toBe(1);
    expect(none.rows).toEqual([{ kind: 'silence', from: '2025-07-08', to: '2025-07-10', count: 3, dayNumber: 8 }]);
  });

  it('shows a stage interrupted by another twice, as it was lived', () => {
    const t = trip();
    t.stages = [createTripStage('Stay', '', '2025-07-01', '2025-07-10'), createTripStage('Trip out', '', '2025-07-04', '2025-07-05')];
    const groups = tripList(t, tripCoverage(t).days);
    expect(groups.map((g) => g.stage?.name)).toEqual(['Stay', 'Trip out', 'Stay']);
    expect(groups.map((g) => g.stageIndex)).toEqual([0, 1, 0]);
  });

  it('finds the group of a date', () => {
    const t = trip();
    const groups = tripList(t, tripCoverage(t).days);
    expect(groupOf(groups, '2025-07-05')).toBe(1);
    expect(groupOf(groups, '2025-07-09')).toBe(2);
    expect(groupOf(groups, '2025-08-01')).toBe(-1);
  });
});
