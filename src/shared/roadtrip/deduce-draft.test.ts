import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  answer,
  applyDraft,
  choosePlace,
  deducedStages,
  draftOutcome,
  draftSize,
  edit,
  haltName,
  haltPlace,
  haltText,
  keepSkips,
  proposeDraft,
  removeDeduced,
  rename,
  resetEdit,
  routeLabel,
  type DeduceDraft,
} from './deduce-draft';
import type { GazetteerCity } from './gazetteer';
import type { NamedLeg } from './group-legs';
import type { TrackLeg } from './segment-track';
import { trackChapters } from './track-chapters';
import { stageLabel } from './trip-places';
import { createTripDoc, createTripPlace, createTripStage, type TripDoc } from './trip-types';

const SOURCE = 'winnow.example';
const NOW = 1_700_000_000_000;

const city = (name: string, lat: number, lon: number, regionKey = 'AU.08', region = 'Western Australia'): GazetteerCity => ({
  name,
  country: 'AU',
  lat,
  lon,
  population: 1000,
  section: false,
  regionKey,
  region,
});

const PERTH = city('Perth', -31.95, 115.86);
const KALBARRI = city('Kalbarri', -27.71, 114.17);
const EXMOUTH = city('Exmouth', -21.93, 114.13);
const BROOME = city('Broome', -17.96, 122.24);
const INDEX = [PERTH, KALBARRI, EXMOUTH, BROOME];

const leg = (startDate: string, endDate: string, at: GazetteerCity | null, extra: Partial<TrackLeg> = {}): TrackLeg => {
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  return {
    startDate,
    endDate,
    centroid: at ? { lat: at.lat, lon: at.lon } : { lat: -16.7, lon: 125.92 },
    dayCount: days,
    bridged: 0,
    count: 100 * days,
    inferred: false,
    short: days < 2,
    absorbed: 0,
    ...extra,
  };
};

/** Perth 2–4 · Kalbarri 5–7 · Exmouth 8–12 · (unnamed) 13–14 · Broome 15–20, one chapter per halt. */
const LEGS = [
  leg('2025-11-02', '2025-11-04', PERTH),
  leg('2025-11-05', '2025-11-07', KALBARRI),
  leg('2025-11-08', '2025-11-12', EXMOUTH),
  leg('2025-11-13', '2025-11-14', null),
  leg('2025-11-15', '2025-11-20', BROOME),
];

const trip = (stages: TripDoc['stages'] = []): TripDoc => ({
  ...createTripDoc('Australia', '2025-11-01', '2025-11-30'),
  stages,
});

const regions = (t: TripDoc, draft: DeduceDraft = EMPTY_DRAFT) =>
  proposeDraft(t, trackChapters(LEGS, INDEX), draft, SOURCE);
const halts = (t: TripDoc, draft: DeduceDraft = EMPTY_DRAFT) =>
  proposeDraft(t, trackChapters(LEGS, INDEX, { grain: 'halts' }), draft, SOURCE);

describe('proposeDraft — the safe verb', () => {
  it('adds a proposal that touches no stage, as it stands', () => {
    const [p] = regions(trip());
    expect(p).toMatchObject({ key: '2025-11-02..2025-11-20', relation: 'free', safe: 'stage', verb: 'stage', already: false });
    // Written as the trip's lists write a stage: the shared state said once.
    expect(p.label).toBe('Perth → Broome, WA');
    expect(p.verbs).toEqual(['stage', 'split', 'skip']);
    expect(p.unnamed).toHaveLength(1);
    expect(p.count).toBe(1900);
  });

  it('gives a stage the author drew the places it lacks, never a second stage', () => {
    const coast = createTripStage('Coral Coast', '', '2025-11-05', '2025-11-12', [createTripPlace('Kalbarri')]);
    const ps = halts(trip([coast]));
    const kalbarri = ps.find((p) => p.key === '2025-11-05..2025-11-07')!;
    const exmouth = ps.find((p) => p.key === '2025-11-08..2025-11-12')!;
    expect(kalbarri).toMatchObject({ relation: 'inside', safe: 'skip', already: true });
    expect(exmouth).toMatchObject({ relation: 'inside', safe: 'into', already: false });
    expect(exmouth.target?.name).toBe('Coral Coast');
    expect(exmouth.extra.map((h) => h.city?.name)).toEqual(['Exmouth']);
    expect(exmouth.verbs).toEqual(['stage', 'into', 'skip']);
  });

  it('offers only the free days where a stage covers part of it', () => {
    const coast = createTripStage('Coral Coast', '', '2025-11-05', '2025-11-12', [createTripPlace('Kalbarri')]);
    const [p] = regions(trip([coast]));
    expect(p).toMatchObject({ relation: 'partial', safe: 'trim', verb: 'trim' });
    expect(p.free.map((f) => [f.startDate, f.endDate, f.halts.map((h) => h.city?.name ?? '?')])).toEqual([
      ['2025-11-02', '2025-11-04', ['Perth']],
      ['2025-11-13', '2025-11-20', ['?', 'Broome']],
    ]);
    expect(p.verbs).toEqual(['stage', 'split', 'trim', 'into', 'skip']);
    expect(p.target?.name).toBe('Coral Coast');
  });

  it('calls a proposal with exactly a stage’s days already in the trip', () => {
    const perth = createTripStage('', '', '2025-11-02', '2025-11-04', [createTripPlace('Perth')]);
    const [p] = halts(trip([perth]));
    expect(p).toMatchObject({ relation: 'same', already: true, safe: 'skip' });
  });

  it('knows the stage it wrote on an earlier run', () => {
    const t = trip();
    const written = applyDraft(t, draftOutcome(halts(t), EMPTY_DRAFT, { sourceId: SOURCE, now: NOW }), NOW).trip;
    const again = halts(written);
    expect(again.every((p) => p.already)).toBe(true);
    expect(again[0].written?.origin?.chapterId).toBe('track:2025-11-02');
  });
});

describe('proposeDraft — answers and edits', () => {
  it('takes the author’s verb where it makes sense, and the safe one where it no longer does', () => {
    let draft = answer(EMPTY_DRAFT, '2025-11-02..2025-11-20', 'split');
    expect(regions(trip(), draft)[0].verb).toBe('split');
    draft = answer(EMPTY_DRAFT, '2025-11-02..2025-11-20', 'into');
    expect(regions(trip(), draft)[0].verb).toBe('stage');
  });

  it('keys the draft on the span, so an answer survives a change of grain that keeps it', () => {
    const draft = answer(EMPTY_DRAFT, '2025-11-02..2025-11-04', 'skip');
    expect(halts(trip(), draft)[0].verb).toBe('skip');
    expect(regions(trip(), draft)[0].verb).toBe('stage');
  });

  it('normalises an edit: what equals the chapter is dropped, an empty edit removed', () => {
    const [p] = regions(trip());
    let draft = edit(EMPTY_DRAFT, p, { name: 'West coast', endDate: '2025-11-21' });
    expect(draft.edits[p.key]).toEqual({ name: 'West coast', endDate: '2025-11-21' });
    const edited = regions(trip(), draft)[0];
    expect(edited).toMatchObject({ edited: true, ownName: 'West coast', label: 'West coast', endDate: '2025-11-21', dayCount: 20 });
    draft = edit(draft, p, { name: '', endDate: '2025-11-20' });
    expect(draft.edits[p.key]).toBeUndefined();
    expect(regions(trip(), draft)[0].edited).toBe(false);
    draft = edit(draft, p, { halts: ['2025-11-02', '2025-11-05'] });
    expect(regions(trip(), draft)[0].halts.map((h) => h.city?.name)).toEqual(['Perth', 'Kalbarri']);
    expect(resetEdit(draft, p.key).edits).toEqual({});
  });

  it('names a halt the index could not, on the trip only, from its measured position', () => {
    const draft = rename(EMPTY_DRAFT, '2025-11-13', 'Mount Barnett');
    const [p] = regions(trip(), draft);
    expect(p.unnamed).toEqual([]);
    const halt = p.halts[3];
    expect(haltPlace(halt, draft)).toMatchObject({
      name: 'Mount Barnett',
      state: '',
      coords: { lat: -16.7, lon: 125.92 },
      arrived: '2025-11-13',
      left: '2025-11-14',
      dateFrom: 'photos',
      source: 'deduced',
    });
    expect(haltPlace(halt, draft)).not.toHaveProperty('countryCode');
    // A named halt carries the city's country as the CODE it is, never as a name.
    expect(haltPlace(p.halts[0], draft)).toMatchObject({ state: 'Western Australia', countryCode: 'AU' });
    expect(haltPlace(p.halts[0], draft)).not.toHaveProperty('country');
    expect(haltPlace(halt, EMPTY_DRAFT)).toBeNull();
    expect(rename(draft, '2025-11-13', '  ').renames).toEqual({});
  });

  it('counts the draft and keeps only the skips across a write', () => {
    const draft = rename(edit(answer(EMPTY_DRAFT, 'a', 'skip'), { key: 'b', chapter: trackChapters(LEGS, INDEX)[0] }, { name: 'X' }), 'h', 'N');
    expect(draftSize(draft)).toEqual({ answers: 1, edits: 1, names: 1 });
    expect(keepSkips(answer(draft, 'c', 'stage'))).toEqual({ answers: { a: 'skip' }, edits: {}, renames: {} });
  });
});

describe('draftOutcome and applyDraft', () => {
  const options = { sourceId: SOURCE, now: NOW };

  it('writes a stage with its places, its mark and a derived name', () => {
    const t = trip();
    const out = draftOutcome(regions(t), EMPTY_DRAFT, options);
    expect(out.adds).toHaveLength(1);
    const { stage } = out.adds[0];
    expect(stage.name).toBe('');
    expect(stageLabel(stage)).toBe('Perth → Broome');
    expect(stage.places.map((p) => p.name)).toEqual(['Perth', 'Kalbarri', 'Exmouth', 'Broome']);
    expect(stage.origin).toEqual({ sourceId: SOURCE, chapterId: 'track:2025-11-02', importedAt: NOW, revision: expect.any(String) });
    const applied = applyDraft(t, out, NOW);
    expect(applied.trip.stages).toHaveLength(1);
    expect(applied.spanWidened).toBe(false);
    expect(deducedStages(applied.trip)).toHaveLength(1);
    expect(removeDeduced(applied.trip, NOW).stages).toEqual([]);
  });

  it('splits into one stage per halt, each keyed on its own first day', () => {
    const draft = answer(EMPTY_DRAFT, '2025-11-02..2025-11-20', 'split');
    const out = draftOutcome(regions(trip(), draft), draft, options);
    expect(out.adds.map((a) => [a.stage.startDate, a.stage.endDate, a.stage.origin?.chapterId])).toEqual([
      ['2025-11-02', '2025-11-04', 'track:2025-11-02'],
      ['2025-11-05', '2025-11-07', 'track:2025-11-05'],
      ['2025-11-08', '2025-11-12', 'track:2025-11-08'],
      ['2025-11-13', '2025-11-14', 'track:2025-11-13'],
      ['2025-11-15', '2025-11-20', 'track:2025-11-15'],
    ]);
    // The unnamed halt gives a stage with its days and no place — never a coordinate dressed as one.
    expect(out.adds[3].stage.places).toEqual([]);
  });

  it('trims to the free days and completes the stage it met, which keeps everything of its own', () => {
    const coast = createTripStage('Coral Coast', '', '2025-11-05', '2025-11-12', [createTripPlace('Kalbarri')]);
    const t = trip([coast]);
    const trimmed = draftOutcome(regions(t), EMPTY_DRAFT, options);
    expect(trimmed.adds.map((a) => stageLabel(a.stage))).toEqual(['Perth', 'Broome']);
    expect(trimmed.over).toEqual([]);

    const draft = answer(EMPTY_DRAFT, '2025-11-02..2025-11-20', 'into');
    const into = draftOutcome(regions(t, draft), draft, options);
    expect(into.adds).toEqual([]);
    expect(into.completes[0].places.map((p) => p.name)).toEqual(['Perth', 'Exmouth', 'Broome']);
    const applied = applyDraft(t, into, NOW).trip;
    expect(applied.stages).toHaveLength(1);
    expect(applied.stages[0]).toMatchObject({ id: coast.id, name: 'Coral Coast', startDate: '2025-11-05', endDate: '2025-11-12' });
    expect(applied.stages[0].places.map((p) => p.name)).toEqual(['Kalbarri', 'Perth', 'Exmouth', 'Broome']);
    expect(applied.stages[0].origin).toBeUndefined();
  });

  it('names an add over a stage the author drew, and never picks it by itself', () => {
    const coast = createTripStage('Coral Coast', '', '2025-11-05', '2025-11-12');
    const draft = answer(EMPTY_DRAFT, '2025-11-02..2025-11-20', 'stage');
    const out = draftOutcome(regions(trip([coast]), draft), draft, options);
    expect(out.over).toHaveLength(1);
    expect(draftOutcome(regions(trip([coast])), EMPTY_DRAFT, options).over).toEqual([]);
  });

  it('writes nothing for a skip, and lists what was left', () => {
    const draft = answer(EMPTY_DRAFT, '2025-11-02..2025-11-20', 'skip');
    const t = trip();
    const out = draftOutcome(regions(t, draft), draft, options);
    expect(out.adds).toEqual([]);
    expect(out.left).toHaveLength(1);
    expect(applyDraft(t, out, NOW).trip).toBe(t);
  });

  it('grows the trip to hold a stage written past its end, and says so', () => {
    const short = { ...trip(), endDate: '2025-11-10' };
    const applied = applyDraft(short, draftOutcome(regions(short), EMPTY_DRAFT, options), NOW);
    expect(applied.spanWidened).toBe(true);
    expect(applied.trip.endDate).toBe('2025-11-20');
  });

  it('reads the route of an edited halt list', () => {
    const named: NamedLeg[] = trackChapters(LEGS, INDEX)[0].halts;
    expect(routeLabel(named.slice(1, 3), EMPTY_DRAFT)).toBe('Kalbarri → Exmouth');
    expect(routeLabel([named[3]], EMPTY_DRAFT)).toBe('');
  });

  it('writes the route as the trip writes its places, given the trip', () => {
    const named: NamedLeg[] = trackChapters(LEGS, INDEX)[0].halts;
    const t = { ...trip(), stateCodes: { 'Western Australia': 'WA' } };
    expect(routeLabel(named.slice(1, 3), EMPTY_DRAFT, t)).toBe('Kalbarri → Exmouth, WA');
    expect(haltText(named[1], EMPTY_DRAFT, t)).toBe('Kalbarri, WA');
    expect(haltText(named[3], EMPTY_DRAFT, t)).toBeNull();
  });

  it('lets a halt take another place than the index’s, and give it back', () => {
    const named: NamedLeg[] = trackChapters(LEGS, INDEX)[0].halts;
    const key = named[2].leg.startDate;
    const draft = choosePlace(EMPTY_DRAFT, key, {
      name: 'Exmouth',
      state: 'England',
      searchCode: 'ENG',
      countryCode: 'GB',
      coords: { lat: 50.62, lon: -3.41 },
      source: 'search',
    });
    expect(haltName(named[2], draft)).toBe('Exmouth');
    const place = haltPlace(named[2], draft)!;
    expect(place).toMatchObject({ name: 'Exmouth', state: 'England', countryCode: 'GB', source: 'search', coords: { lat: 50.62, lon: -3.41 } });
    // The halt's own days still travel with the place chosen for it.
    expect(place.arrived).toBe(named[2].leg.startDate);
    expect(draftSize(draft).names).toBe(1);
    expect(choosePlace(draft, key, null)).toEqual(EMPTY_DRAFT);
    // A halt the index could not name takes a chosen place too.
    const named3 = choosePlace(EMPTY_DRAFT, named[3].leg.startDate, { name: 'Halls Creek', state: '', coords: { lat: -18.2, lon: 127.7 }, source: 'typed' });
    expect(haltName(named[3], named3)).toBe('Halls Creek');
  });
});
