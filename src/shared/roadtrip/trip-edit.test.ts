import { describe, expect, it } from 'vitest';
import {
  applyTripDetails,
  hasImpact,
  retimeStages,
  setTripRoute,
  spanImpact,
} from './trip-edit';
import { tripRouteEnds, tripRouteLabel } from './trip-places';
import {
  createTripDoc,
  createTripPlace,
  createTripPost,
  createTripStage,
  type TripDoc,
  type TripPlace,
} from './trip-types';

function trip(places: TripPlace[] = []): TripDoc {
  return createTripDoc('Australie', '', '2025-11-02', '2025-11-30', places);
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

describe('setTripRoute', () => {
  it('seeds one leg over the whole trip when there is none', () => {
    const doc = trip();
    const stages = setTripRoute(doc, createTripPlace('Perth'), createTripPlace('Cairns'));
    expect(stages).toHaveLength(1);
    expect(stages[0].startDate).toBe('2025-11-02');
    expect(stages[0].endDate).toBe('2025-11-30');
    expect(stages[0].places.map((p) => p.name)).toEqual(['Perth', 'Cairns']);
  });

  it('seeds nothing when both ends are left empty', () => {
    expect(setTripRoute(trip(), createTripPlace(), createTripPlace())).toEqual([]);
  });

  it('writes onto the ends the trip already names, keeping their ids', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const ends = tripRouteEnds(doc);
    const stages = setTripRoute(
      doc,
      { ...ends.from!, name: 'Fremantle' },
      { ...ends.to!, name: 'Darwin', region: 'NT' },
    );
    expect(tripRouteLabel({ stages })).toBe('Fremantle → Darwin');
    expect(stages[0].places[0].id).toBe(ends.from!.id);
    expect(stages[0].places[1].region).toBe('NT');
  });

  it('leaves the places between the two ends alone', () => {
    const doc = trip([
      createTripPlace('Perth'),
      createTripPlace('Kalbarri'),
      createTripPlace('Cairns'),
    ]);
    const stages = setTripRoute(doc, createTripPlace('Fremantle'), createTripPlace('Darwin'));
    expect(stages[0].places.map((p) => p.name)).toEqual(['Fremantle', 'Kalbarri', 'Darwin']);
  });

  it('adds a second end to a trip that named only one, with an id of its own', () => {
    const doc = trip([createTripPlace('Perth')]);
    const ends = tripRouteEnds(doc);
    expect(ends.from!.id).toBe(ends.to!.id);
    const stages = setTripRoute(doc, ends.from!, { ...ends.to!, name: 'Cairns' });
    const places = stages[0].places;
    expect(places.map((p) => p.name)).toEqual(['Perth', 'Cairns']);
    expect(places[0].id).not.toBe(places[1].id);
  });

  it('adds the end to the LAST leg and the start to the first', () => {
    const doc = trip();
    doc.stages = [
      createTripStage('', '', '2025-11-02', '2025-11-10', []),
      createTripStage('', '', '2025-11-11', '2025-11-30', []),
    ];
    const stages = setTripRoute(doc, createTripPlace('Perth'), createTripPlace('Cairns'));
    expect(stages[0].places.map((p) => p.name)).toEqual(['Perth']);
    expect(stages[1].places.map((p) => p.name)).toEqual(['Cairns']);
  });

  it('removes an end whose name was cleared, keeping the leg', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const ends = tripRouteEnds(doc);
    const stages = setTripRoute(doc, { ...ends.from!, name: '' }, ends.to!);
    expect(stages).toHaveLength(1);
    expect(stages[0].places.map((p) => p.name)).toEqual(['Cairns']);
  });

  it('does not mutate the trip it was given', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const before = JSON.stringify(doc.stages);
    setTripRoute(doc, createTripPlace('Fremantle'), createTripPlace('Darwin'));
    expect(JSON.stringify(doc.stages)).toBe(before);
  });
});

describe('applyTripDetails', () => {
  it('moves the dates and brings the legs inside the new span', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    const next = applyTripDetails(doc, {
      startDate: '2025-11-10',
      endDate: '2025-11-20',
      from: tripRouteEnds(doc).from!,
      to: tripRouteEnds(doc).to!,
    });
    expect(next.startDate).toBe('2025-11-10');
    expect(next.stages[0].startDate).toBe('2025-11-10');
    expect(next.stages[0].endDate).toBe('2025-11-20');
  });

  it('never touches the posts, even one left outside', () => {
    const doc = trip();
    doc.posts = [createTripPost('reel', '2025-11-03', 'early')];
    const next = applyTripDetails(doc, {
      startDate: '2025-11-10',
      endDate: '2025-11-20',
      from: createTripPlace(),
      to: createTripPlace(),
    });
    expect(next.posts).toEqual(doc.posts);
  });

  it('follows the route with the destination when the route changed', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    doc.destination = 'Perth → Cairns';
    const ends = tripRouteEnds(doc);
    const next = applyTripDetails(doc, {
      startDate: doc.startDate,
      endDate: doc.endDate,
      from: ends.from!,
      to: { ...ends.to!, name: 'Darwin' },
    });
    expect(next.destination).toBe('Perth → Darwin');
  });

  it('keeps a destination the route did not write when only the dates move', () => {
    const doc = trip([createTripPlace('Perth'), createTripPlace('Cairns')]);
    doc.destination = 'Western Australia, the long way';
    const ends = tripRouteEnds(doc);
    const next = applyTripDetails(doc, {
      startDate: '2025-11-05',
      endDate: '2025-11-25',
      from: ends.from!,
      to: ends.to!,
    });
    expect(next.destination).toBe('Western Australia, the long way');
  });

  it('seeds the route over the NEW span, not the old one', () => {
    const doc = trip();
    const next = applyTripDetails(doc, {
      startDate: '2025-11-10',
      endDate: '2025-11-20',
      from: createTripPlace('Perth'),
      to: createTripPlace('Cairns'),
    });
    expect(next.stages[0].startDate).toBe('2025-11-10');
    expect(next.stages[0].endDate).toBe('2025-11-20');
  });
});
