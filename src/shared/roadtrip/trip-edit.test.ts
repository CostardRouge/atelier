import { describe, expect, it } from 'vitest';
import { applyTripDetails, hasImpact, retimeStages, spanImpact } from './trip-edit';
import {
  createTripDoc,
  createTripPlace,
  createTripPost,
  createTripStage,
  type TripDoc,
  type TripPlace,
} from './trip-types';

/** A trip over the whole of November, optionally with one leg naming `places`. */
function trip(places: TripPlace[] = []): TripDoc {
  const doc = createTripDoc('Australie', '2025-11-02', '2025-11-30');
  if (places.length) {
    doc.stages = [createTripStage('', '', '2025-11-02', '2025-11-30', places)];
  }
  return doc;
}

describe('spanImpact', () => {
  it('says nothing when the span only grows', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const impact = spanImpact(doc, '2025-11-01', '2025-12-10');
    expect(impact).toEqual({ trimmedStages: 0, droppedStages: 0, strandedPosts: 0 });
    expect(hasImpact(impact)).toBe(false);
  });

  it('counts a leg that overhangs as trimmed and one outside as dropped', () => {
    const doc = trip();
    doc.stages = [
      createTripStage('', '', '2025-11-02', '2025-11-10', []),
      createTripStage('', '', '2025-11-20', '2025-11-30', []),
    ];
    const impact = spanImpact(doc, '2025-11-05', '2025-11-15');
    expect(impact.trimmedStages).toBe(1);
    expect(impact.droppedStages).toBe(1);
    expect(hasImpact(impact)).toBe(true);
  });

  it('counts a piece left outside, including a multi-day one that still reaches in', () => {
    const doc = trip();
    doc.posts = [
      createTripPost('reel', '2025-11-03', 'gone'),
      createTripPost('carousel', '2025-11-04', 'reaches in', '2025-11-08'),
      createTripPost('reel', '2025-11-20', 'inside'),
    ];
    expect(spanImpact(doc, '2025-11-06', '2025-11-30').strandedPosts).toBe(1);
  });
});

describe('retimeStages', () => {
  it('trims what overhangs and drops what falls outside', () => {
    const stages = [
      createTripStage('a', '', '2025-11-02', '2025-11-10', []),
      createTripStage('b', '', '2025-11-11', '2025-11-14', []),
      createTripStage('c', '', '2025-11-20', '2025-11-30', []),
    ];
    const out = retimeStages(stages, '2025-11-05', '2025-11-15');
    expect(out.map((s) => s.name)).toEqual(['a', 'b']);
    expect(out[0].startDate).toBe('2025-11-05');
    expect(out[0].endDate).toBe('2025-11-10');
  });

  it('returns the very same object for a leg it does not touch', () => {
    const stage = createTripStage('a', '', '2025-11-02', '2025-11-10', []);
    expect(retimeStages([stage], '2025-11-01', '2025-11-30')[0]).toBe(stage);
  });
});

describe('applyTripDetails', () => {
  it('moves the dates and brings the legs inside the new span', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const next = applyTripDetails(doc, { startDate: '2025-11-10', endDate: '2025-11-20' });
    expect(next.startDate).toBe('2025-11-10');
    expect(next.stages[0].startDate).toBe('2025-11-10');
    expect(next.stages[0].endDate).toBe('2025-11-20');
  });

  it('never touches the posts, even one left outside', () => {
    const doc = trip();
    doc.posts = [createTripPost('reel', '2025-11-03', 'early')];
    const next = applyTripDetails(doc, { startDate: '2025-11-10', endDate: '2025-11-20' });
    expect(next.posts).toEqual(doc.posts);
  });

  it('leaves the places of the legs it keeps exactly as they were', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const next = applyTripDetails(doc, { startDate: '2025-11-05', endDate: '2025-11-25' });
    expect(next.stages[0].places.map((p) => p.name)).toEqual(['Perth', 'Cairns']);
  });

  it('does not mutate the trip it was given', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const before = JSON.stringify(doc);
    applyTripDetails(doc, { startDate: '2025-11-10', endDate: '2025-11-20' });
    expect(JSON.stringify(doc)).toBe(before);
  });
});
