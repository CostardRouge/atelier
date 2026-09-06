import { describe, expect, it } from 'vitest';
import {
  applyTimelineDiff,
  diffTimeline,
  importTimeline,
  tripFromTimeline,
  type TimelineChapter,
} from './timeline-import';
import { stageLabel, stageRegionLabel } from './trip-places';
import { stageAt } from './trip-coverage';
import {
  createTripDoc,
  createTripPlace,
  createTripPost,
  createTripStage,
  type TripDoc,
} from './trip-types';

const SOURCE = 'winnow.example';
const options = { sourceId: SOURCE, importedAt: 1_700_000_000_000 };

const chapter = (over: Partial<TimelineChapter> & { id: string }): TimelineChapter => ({
  title: null,
  startDate: '2025-11-02',
  endDate: '2025-11-04',
  places: [],
  ...over,
});

/** Three legs of the Australian trip, as a timeline would send them. */
const australia = (): TimelineChapter[] => [
  chapter({
    id: '1',
    title: 'Perth',
    startDate: '2025-11-02',
    endDate: '2025-11-04',
    places: [{ name: 'Perth', region: 'Western Australia', lat: -31.95, lon: 115.86 }],
  }),
  chapter({
    id: '2',
    title: 'Kalbarri',
    startDate: '2025-11-05',
    endDate: '2025-11-08',
    places: [{ name: 'Kalbarri', region: 'Western Australia' }],
  }),
  chapter({
    id: '3',
    title: 'Alice Springs → Uluru',
    startDate: '2025-11-12',
    endDate: '2025-11-15',
    places: [
      { name: 'Alice Springs', region: 'Northern Territory' },
      { name: 'Uluru', region: 'Northern Territory' },
    ],
    revision: 'r7',
  }),
];

describe('importTimeline — the mapping', () => {
  it('turns each chapter into a stage, in lived order, with its origin', () => {
    const { stages, warnings } = importTimeline(australia(), options);
    expect(warnings).toEqual([]);
    expect(stages.map((s) => s.startDate)).toEqual(['2025-11-02', '2025-11-05', '2025-11-12']);
    expect(stages[0].origin).toEqual({
      sourceId: SOURCE,
      chapterId: '1',
      importedAt: options.importedAt,
    });
    expect(stages[2].origin?.revision).toBe('r7');
  });

  it('never reuses the chapter id as the stage id', () => {
    const { stages } = importTimeline(australia(), options);
    expect(stages.map((s) => s.id)).not.toContain('1');
    expect(new Set(stages.map((s) => s.id)).size).toBe(3);
  });

  it('carries the places in order, region on the place, coordinates only when sound', () => {
    const { stages } = importTimeline(australia(), options);
    expect(stages[2].places.map((p) => p.name)).toEqual(['Alice Springs', 'Uluru']);
    expect(stages[0].places[0].coords).toEqual({ lat: -31.95, lon: 115.86 });
    expect(stages[1].places[0].coords).toBeNull();
    expect(stages[0].places[0].region).toBe('Western Australia');
    // The stage's own region stays empty: it derives from what the places agree on.
    expect(stages[0].region).toBe('');
    expect(stageRegionLabel(stages[2])).toBe('Northern Territory');
  });

  it('drops a place with no name — a point nobody can say is not a place', () => {
    const { stages } = importTimeline(
      [chapter({ id: 'x', places: [{ name: '  ', lat: 1, lon: 2 }, { name: 'Broome' }] })],
      options,
    );
    expect(stages[0].places.map((p) => p.name)).toEqual(['Broome']);
  });

  it('refuses coordinates off the globe rather than storing them', () => {
    const { stages } = importTimeline(
      [chapter({ id: 'x', places: [{ name: 'Nowhere', lat: 91, lon: 10 }] })],
      options,
    );
    expect(stages[0].places[0].coords).toBeNull();
  });

  it('yields a stage with a span and NO place when the chapter has none', () => {
    const { stages } = importTimeline([chapter({ id: 'x', title: null, places: [] })], options);
    expect(stages).toHaveLength(1);
    expect(stages[0].places).toEqual([]);
    expect(stageLabel(stages[0])).toBe('');
  });
});

describe('importTimeline — empty means derived', () => {
  it('leaves the name EMPTY when the title only says the route', () => {
    const { stages } = importTimeline(australia(), options);
    expect(stages[0].name).toBe('');
    expect(stages[2].name).toBe('');
    expect(stageLabel(stages[2])).toBe('Alice Springs → Uluru');
  });

  it('recognises the route whatever the instance joined it with', () => {
    for (const title of ['Alice Springs - Uluru', 'alice springs to uluru', 'Alice Springs -> Uluru']) {
      const [ch] = importTimeline([{ ...australia()[2], title }], options).stages;
      expect(ch.name, title).toBe('');
    }
  });

  it('keeps a title that says more than the route', () => {
    const [ch] = importTimeline([{ ...australia()[2], title: 'The Red Centre' }], options).stages;
    expect(ch.name).toBe('The Red Centre');
    expect(stageLabel(ch)).toBe('The Red Centre');
  });

  it('keeps a title when there is no place to derive from', () => {
    const [ch] = importTimeline([chapter({ id: 'x', title: 'Day at sea', places: [] })], options).stages;
    expect(ch.name).toBe('Day at sea');
  });
});

describe('importTimeline — dates are taken, never recomputed', () => {
  it('refuses an instant rather than slicing a day out of it', () => {
    // 07:00 in Perth is the 12th on the wall and the 11th in UTC; whichever
    // day a slice picked, it would be a guess the browser made.
    const r = importTimeline(
      [chapter({ id: 'x', startDate: '2026-02-11T23:00:00Z', endDate: '2026-02-12' })],
      options,
    );
    expect(r.stages).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ kind: 'not-a-date', chapterId: 'x' });
    expect(r.warnings[0].message).toContain('2026-02-11T23:00:00Z');
  });

  it('leaves out a chapter with no dated media, and says so', () => {
    const r = importTimeline([chapter({ id: 'x', title: 'Odd', startDate: null, endDate: null })], options);
    expect(r.stages).toEqual([]);
    expect(r.warnings[0]).toMatchObject({ kind: 'no-dates', chapterId: 'x' });
    expect(r.warnings[0].message).toContain('Odd');
  });

  it('treats one missing date like none — half a span is not a span', () => {
    const r = importTimeline([chapter({ id: 'x', startDate: '2025-11-02', endDate: null })], options);
    expect(r.stages).toEqual([]);
    expect(r.warnings[0].kind).toBe('not-a-date');
  });

  it('swaps a reversed span and says it did', () => {
    const r = importTimeline([chapter({ id: 'x', startDate: '2025-11-08', endDate: '2025-11-05' })], options);
    expect(r.stages[0]).toMatchObject({ startDate: '2025-11-05', endDate: '2025-11-08' });
    expect(r.warnings[0].kind).toBe('reversed-span');
  });

  it('keeps the first of two chapters sharing an id', () => {
    const r = importTimeline([chapter({ id: 'x', title: 'First' }), chapter({ id: 'x', title: 'Second' })], options);
    expect(r.stages).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ kind: 'duplicate-id', chapterId: 'x' });
  });
});

describe('importTimeline — span, holes and overlaps', () => {
  it('derives the span from the first start to the last end', () => {
    expect(importTimeline(australia(), options).span).toEqual({
      startDate: '2025-11-02',
      endDate: '2025-11-15',
    });
  });

  it('has no span when nothing dated came in', () => {
    const r = importTimeline([chapter({ id: 'x', startDate: null, endDate: null })], options);
    expect(r.span).toBeNull();
    expect(r.uncovered).toEqual([]);
    expect(r.destination).toBe('');
  });

  it('says which days belong to no leg instead of quietly producing holes', () => {
    expect(importTimeline(australia(), options).uncovered).toEqual([
      { start: '2025-11-09', end: '2025-11-11', length: 3 },
    ]);
  });

  it('names an overlap and says which leg a badge would name', () => {
    const r = importTimeline(
      [
        chapter({ id: 'a', startDate: '2025-11-02', endDate: '2025-11-05', places: [{ name: 'Perth' }] }),
        chapter({ id: 'b', startDate: '2025-11-05', endDate: '2025-11-08', places: [{ name: 'Kalbarri' }] }),
      ],
      options,
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ kind: 'overlap', chapterId: 'b' });
    expect(r.warnings[0].message).toBe(
      '“Perth” and “Kalbarri” share 1 day; on those, a badge names the later one.',
    );
    // …which is what the trip will really do with them.
    const trip = tripFromTimeline('Australie', r)!;
    expect(stageLabel(stageAt(trip, '2025-11-05')!)).toBe('Kalbarri');
  });

  it('orders by span even when the timeline arrives out of order', () => {
    const [c, a, b] = australia();
    const r = importTimeline([c, a, b], options);
    expect(r.stages.map((s) => s.origin!.chapterId)).toEqual(['1', '2', '3']);
    expect(r.warnings).toEqual([]);
  });

  it('composes the destination the way the New trip modal does', () => {
    expect(importTimeline(australia(), options).destination).toBe('Perth → Uluru');
  });
});

describe('tripFromTimeline', () => {
  it('creates a trip with the span and the stages, and no post at all', () => {
    const trip = tripFromTimeline('Australie', importTimeline(australia(), options))!;
    expect(trip.name).toBe('Australie');
    expect(trip.destination).toBe('Perth → Uluru');
    expect(trip.startDate).toBe('2025-11-02');
    expect(trip.endDate).toBe('2025-11-15');
    expect(trip.stages).toHaveLength(3);
    expect(trip.posts).toEqual([]);
  });

  it('starts with the factory voice — a source has no opinion about how a trip is told', () => {
    const trip = tripFromTimeline('A', importTimeline(australia(), options))!;
    const fresh = createTripDoc('A', '', '2025-11-02', '2025-11-15');
    expect(trip.badgeWords).toEqual(fresh.badgeWords);
    expect(trip.theme).toEqual(fresh.theme);
    expect(trip.cta).toEqual(fresh.cta);
    expect(trip.hookDefaults).toEqual({});
  });

  it('lives in this browser, not on the instance the timeline came from', () => {
    const trip = tripFromTimeline('A', importTimeline(australia(), options))!;
    expect(trip.sourceId).toBe('local');
    expect(trip.stages[0].origin?.sourceId).toBe(SOURCE);
  });

  it('makes nothing from an empty timeline', () => {
    expect(tripFromTimeline('A', importTimeline([], options))).toBeNull();
  });

  it('does not share structure with the import', () => {
    const imported = importTimeline(australia(), options);
    const trip = tripFromTimeline('A', imported)!;
    trip.stages[0].name = 'changed';
    expect(imported.stages[0].name).toBe('');
  });
});

describe('diffTimeline — re-running an import is a proposal', () => {
  const seeded = (): TripDoc => tripFromTimeline('Australie', importTimeline(australia(), options))!;

  it('finds nothing to do when the timeline has not moved', () => {
    const entries = diffTimeline(seeded(), importTimeline(australia(), options), SOURCE);
    expect(entries.map((e) => e.kind)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(entries.every((e) => e.matchedBy === 'id')).toBe(true);
  });

  it('proposes to ADD a leg the timeline gained', () => {
    const chapters = [
      ...australia(),
      chapter({ id: '4', startDate: '2025-11-09', endDate: '2025-11-11', places: [{ name: 'Exmouth' }] }),
    ];
    const entries = diffTimeline(seeded(), importTimeline(chapters, options), SOURCE);
    const add = entries.find((e) => e.kind === 'add')!;
    expect(add.incoming?.origin?.chapterId).toBe('4');
    expect(add.existing).toBeNull();
    expect(add.key).toBe('chapter:4');
  });

  it('reports a rename as a change, and says which fields moved', () => {
    const chapters = australia();
    chapters[2].title = 'The Red Centre';
    const entries = diffTimeline(seeded(), importTimeline(chapters, options), SOURCE);
    const changed = entries.find((e) => e.kind === 'changed')!;
    expect(changed.existing?.origin?.chapterId).toBe('3');
    expect(changed.changes).toEqual(['name']);
  });

  it('reports a re-clustered span and a changed route', () => {
    const chapters = australia();
    chapters[1].endDate = '2025-11-10';
    chapters[1].places = [{ name: 'Kalbarri' }, { name: 'Shark Bay' }];
    const entries = diffTimeline(seeded(), importTimeline(chapters, options), SOURCE);
    const changed = entries.find((e) => e.kind === 'changed')!;
    // The title "Kalbarri" still names the leg on both sides, so the name
    // did not move — only what the timeline actually changed is listed.
    expect(changed.changes).toEqual(['span', 'places']);
  });

  it('proposes to DROP a seeded leg whose chapter is gone — and never a hand-made one', () => {
    const trip = seeded();
    trip.stages.push(
      createTripStage('Brittany detour', '', '2025-11-20', '2025-11-22', [createTripPlace('Brest')]),
    );
    const entries = diffTimeline(trip, importTimeline(australia().slice(0, 2), options), SOURCE);
    const dropped = entries.filter((e) => e.kind === 'dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0].existing?.origin?.chapterId).toBe('3');
    expect(dropped[0].key).toBe(`stage:${dropped[0].existing!.id}`);
    expect(entries.some((e) => e.existing?.name === 'Brittany detour')).toBe(false);
  });

  it('leaves a leg seeded from ANOTHER instance alone', () => {
    const trip = seeded();
    trip.stages[0].origin = { ...trip.stages[0].origin!, sourceId: 'other.example' };
    const entries = diffTimeline(trip, importTimeline(australia().slice(1), options), SOURCE);
    expect(entries.some((e) => e.kind === 'dropped')).toBe(false);
  });

  it('meets a hand-drawn stage by its span when ids are useless', () => {
    const trip = createTripDoc('Australie', '', '2025-11-01', '2025-11-30');
    trip.stages = [createTripStage('', '', '2025-11-05', '2025-11-08', [createTripPlace('Kalbarri')])];
    const entries = diffTimeline(trip, importTimeline(australia(), options), SOURCE);
    const met = entries.find((e) => e.incoming?.origin?.chapterId === '2')!;
    expect(met.kind).toBe('unchanged');
    expect(met.matchedBy).toBe('span');
    expect(entries.filter((e) => e.kind === 'add')).toHaveLength(2);
  });

  it('meets a re-clustered chapter by its first place and an overlapping span', () => {
    const trip = seeded();
    // Nightly re-clustering: new ids, Kalbarri now a day longer.
    const chapters = australia().map((c, i) => ({ ...c, id: `new-${i}` }));
    chapters[1].endDate = '2025-11-09';
    const entries = diffTimeline(trip, importTimeline(chapters, options), SOURCE);
    const kalbarri = entries.find((e) => e.incoming?.origin?.chapterId === 'new-1')!;
    expect(kalbarri.matchedBy).toBe('place');
    expect(kalbarri.kind).toBe('changed');
    expect(kalbarri.changes).toEqual(['span']);
    // Same span → matched by span, before the place fallback is tried.
    expect(entries.find((e) => e.incoming?.origin?.chapterId === 'new-0')?.matchedBy).toBe('span');
    expect(entries.some((e) => e.kind === 'dropped')).toBe(false);
  });

  it('lists entries in lived order', () => {
    const chapters = [
      chapter({ id: 'late', startDate: '2025-11-20', endDate: '2025-11-21' }),
      ...australia(),
    ];
    const entries = diffTimeline(seeded(), importTimeline(chapters, options), SOURCE);
    expect(entries.map((e) => (e.incoming ?? e.existing)!.startDate)).toEqual([
      '2025-11-02',
      '2025-11-05',
      '2025-11-12',
      '2025-11-20',
    ]);
  });
});

describe('applyTimelineDiff — only what was accepted, and nothing else', () => {
  const seeded = (): TripDoc => {
    const trip = tripFromTimeline('Australie', importTimeline(australia(), options))!;
    trip.posts = [createTripPost('reel', '2025-11-06', 'Cliffs')];
    trip.theme = null;
    trip.stages[1].region = 'WA (typed)';
    return trip;
  };
  const moved = () => {
    const chapters = [
      ...australia(),
      chapter({ id: '4', startDate: '2025-11-18', endDate: '2025-11-20', places: [{ name: 'Cairns' }] }),
    ];
    chapters[1].title = 'Kalbarri gorges';
    return importTimeline(chapters.slice(1), { ...options, importedAt: 2 });
  };

  it('changes nothing when nothing was accepted — the same object comes back', () => {
    const trip = seeded();
    const entries = diffTimeline(trip, moved(), SOURCE);
    const result = applyTimelineDiff(trip, entries, []);
    expect(result.trip).toBe(trip);
    expect(result.spanWidened).toBe(false);
  });

  it('adds an accepted leg and widens the span to hold it, saying so', () => {
    const trip = seeded();
    const entries = diffTimeline(trip, moved(), SOURCE);
    const add = entries.find((e) => e.kind === 'add')!;
    const result = applyTimelineDiff(trip, entries, [add.key], 5);
    expect(result.trip.stages.map((s) => s.origin?.chapterId)).toEqual(['1', '2', '3', '4']);
    expect(result.trip.endDate).toBe('2025-11-20');
    expect(result.trip.startDate).toBe('2025-11-02');
    expect(result.spanWidened).toBe(true);
    expect(result.trip.updatedAt).toBe(5);
  });

  it('takes a change onto the SAME stage, keeping its id and the typed region', () => {
    const trip = seeded();
    const before = trip.stages[1];
    const entries = diffTimeline(trip, moved(), SOURCE);
    const changed = entries.find((e) => e.kind === 'changed')!;
    const after = applyTimelineDiff(trip, entries, [changed.key], 9).trip.stages[1];
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Kalbarri gorges');
    expect(after.region).toBe('WA (typed)');
    expect(after.origin).toEqual({ sourceId: SOURCE, chapterId: '2', importedAt: 9 });
  });

  it('removes an accepted drop', () => {
    const trip = seeded();
    const entries = diffTimeline(trip, moved(), SOURCE);
    const dropped = entries.find((e) => e.kind === 'dropped')!;
    const result = applyTimelineDiff(trip, entries, [dropped.key]);
    expect(result.trip.stages.map((s) => s.origin?.chapterId)).toEqual(['2', '3']);
    // The span never shrinks: the days are still the trip's, told or not.
    expect(result.trip.startDate).toBe('2025-11-02');
    expect(result.spanWidened).toBe(false);
  });

  it('stamps the origin onto a hand-made stage it met, when that is accepted', () => {
    const trip = createTripDoc('Australie', '', '2025-11-01', '2025-11-30');
    trip.stages = [createTripStage('', '', '2025-11-05', '2025-11-08', [createTripPlace('Kalbarri')])];
    const entries = diffTimeline(trip, importTimeline(australia(), options), SOURCE);
    const met = entries.find((e) => e.matchedBy === 'span')!;
    const after = applyTimelineDiff(trip, entries, [met.key], 3).trip;
    expect(after.stages[0].origin).toEqual({ sourceId: SOURCE, chapterId: '2', importedAt: 3 });
    expect(after.stages[0].id).toBe(trip.stages[0].id);
  });

  it('never touches the posts, the words, the theme, the call to action or the defaults', () => {
    const trip = seeded();
    const entries = diffTimeline(trip, moved(), SOURCE);
    const result = applyTimelineDiff(trip, entries, entries.map((e) => e.key));
    expect(result.trip.posts).toEqual(trip.posts);
    expect(result.trip.badgeWords).toEqual(trip.badgeWords);
    expect(result.trip.theme).toBeNull();
    expect(result.trip.cta).toEqual(trip.cta);
    expect(result.trip.hookDefaults).toEqual(trip.hookDefaults);
    expect(result.trip.id).toBe(trip.id);
  });

  it('does not mutate the trip it was given', () => {
    const trip = seeded();
    const snapshot = structuredClone(trip);
    const entries = diffTimeline(trip, moved(), SOURCE);
    applyTimelineDiff(trip, entries, entries.map((e) => e.key));
    expect(trip).toEqual(snapshot);
  });
});
