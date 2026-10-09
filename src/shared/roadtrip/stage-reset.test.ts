import { describe, expect, it } from 'vitest';
import { canReset, resetStages, stageResetCounts } from './stage-reset';
import { createTripDoc, createTripPlace, createTripStage, type TripDoc } from './trip-types';

const NOW = 1_760_000_000_000;

function trip(): TripDoc {
  const mine = createTripStage('Coral Coast', 'Queensland', '2025-11-05', '2025-11-12', [
    createTripPlace('Noosa', 'Queensland', { lat: -26.39, lon: 153.09 }),
    createTripPlace('Rainbow Beach', 'Queensland'),
  ]);
  const deduced = {
    ...createTripStage('', '', '2025-11-13', '2025-11-15', [createTripPlace('Hervey Bay', '', { lat: -25.29, lon: 152.84 })]),
    origin: { sourceId: 'winnow.example', chapterId: 'track:2025-11-13', importedAt: NOW, revision: 'r' },
  };
  const empty = createTripStage('Rest', '', '2025-11-16', '2025-11-17');
  return {
    ...createTripDoc('Australia', '2025-11-01', '2025-11-30'),
    stages: [mine, deduced, empty],
    stateCodes: { Queensland: 'QLD' },
  };
}

describe('stageResetCounts', () => {
  it('counts the legs, the places, the located ones and what Deduce wrote', () => {
    expect(stageResetCounts(trip())).toEqual({ stages: 3, places: 3, located: 2, deduced: 1 });
  });

  it('offers only a verb that has something to do', () => {
    const none = stageResetCounts({ stages: [] });
    expect(canReset(none, 'stages')).toBe(false);
    expect(canReset(none, 'places')).toBe(false);
    expect(canReset(none, 'deduced')).toBe(false);
    const bare = stageResetCounts({ stages: [createTripStage('Rest', '', '2025-11-16', '2025-11-17')] });
    expect(canReset(bare, 'stages')).toBe(true);
    expect(canReset(bare, 'places')).toBe(false);
  });
});

describe('resetStages', () => {
  it('stages: no leg left, the span, the pieces and the code table kept', () => {
    const before = trip();
    const next = resetStages(before, 'stages', NOW);
    expect(next.stages).toEqual([]);
    expect(next.startDate).toBe(before.startDate);
    expect(next.endDate).toBe(before.endDate);
    expect(next.posts).toBe(before.posts);
    expect(next.stateCodes).toEqual({ Queensland: 'QLD' });
    expect(next.updatedAt).toBe(NOW);
  });

  it('places: every leg keeps its dates, name and region, and no place', () => {
    const before = trip();
    const next = resetStages(before, 'places', NOW);
    expect(next.stages.map((s) => [s.id, s.name, s.region, s.startDate, s.endDate, s.places.length])).toEqual(
      before.stages.map((s) => [s.id, s.name, s.region, s.startDate, s.endDate, 0]),
    );
    // A leg that held nothing is handed back as it was.
    expect(next.stages[2]).toBe(before.stages[2]);
    expect(next.stages[1].origin).toEqual(before.stages[1].origin);
  });

  it('deduced: only the legs Deduce wrote go', () => {
    const before = trip();
    const next = resetStages(before, 'deduced', NOW);
    expect(next.stages.map((s) => s.id)).toEqual([before.stages[0].id, before.stages[2].id]);
  });

  it('never mutates the trip it was given', () => {
    const before = trip();
    const snapshot = JSON.stringify(before);
    resetStages(before, 'places', NOW);
    resetStages(before, 'stages', NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
