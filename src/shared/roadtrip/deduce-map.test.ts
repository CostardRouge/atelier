import { describe, expect, it } from 'vitest';
import type { DayPoint } from './day-track';
import { EMPTY_DRAFT, answer, edit, proposeDraft, type DeduceDraft } from './deduce-draft';
import { deduceMapContent } from './deduce-map';
import type { GazetteerCity } from './gazetteer';
import type { TrackLeg } from './segment-track';
import { trackChapters } from './track-chapters';
import { createTripDoc, createTripPlace, createTripStage, type TripDoc } from './trip-types';

const city = (name: string, lat: number, lon: number, country = 'AU'): GazetteerCity => ({
  name,
  country,
  lat,
  lon,
  population: 1000,
  section: false,
  regionKey: `${country}.01`,
  region: '',
});

const PERTH = city('Perth', -31.95, 115.86);
const EXMOUTH = city('Exmouth', -21.93, 114.13);
// The search's favourite mistake, kept by the deduction: a day of pictures that claims Devon.
const DEVON = city('Exmouth', 50.62, -3.41, 'GB');
const BROOME = city('Broome', -17.96, 122.24);

const leg = (startDate: string, endDate: string, at: GazetteerCity): TrackLeg => {
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  return {
    startDate,
    endDate,
    centroid: { lat: at.lat, lon: at.lon },
    dayCount: days,
    bridged: 0,
    count: 10 * days,
    inferred: false,
    short: days < 2,
    absorbed: 0,
  };
};

const LEGS = [leg('2025-11-02', '2025-11-04', PERTH), leg('2025-11-05', '2025-11-06', DEVON), leg('2025-11-07', '2025-11-09', EXMOUTH), leg('2025-11-10', '2025-11-12', BROOME)];
const INDEX = [PERTH, EXMOUTH, DEVON, BROOME];
const day = (date: string, at: GazetteerCity): DayPoint => ({ date, lat: at.lat, lon: at.lon, count: 10, measured: 10, inferred: false });
const POINTS: DayPoint[] = LEGS.flatMap((l) => {
  const at = INDEX.find((c) => c.lat === l.centroid.lat)!;
  const out: DayPoint[] = [];
  for (let t = Date.parse(l.startDate); t <= Date.parse(l.endDate); t += 86_400_000) out.push(day(new Date(t).toISOString().slice(0, 10), at));
  return out;
});

const trip = (stages: TripDoc['stages'] = []): TripDoc => ({ ...createTripDoc('Australia', '2025-11-01', '2025-11-30'), stages });
const halts = (t: TripDoc, draft: DeduceDraft = EMPTY_DRAFT) => proposeDraft(t, trackChapters(LEGS, INDEX, { grain: 'halts' }), draft, 'winnow.example');
const regions = (t: TripDoc, draft: DeduceDraft = EMPTY_DRAFT) => proposeDraft(t, trackChapters(LEGS, INDEX, { grain: 'regions' }), draft, 'winnow.example');
const devonKey = '2025-11-05..2025-11-06';

describe('deduceMapContent', () => {
  it('shows everything the deduction found while nothing is answered', () => {
    const ps = halts(trip());
    const content = deduceMapContent(ps, EMPTY_DRAFT, POINTS);
    expect(content.proposals).toHaveLength(ps.length);
    expect(content.route).toHaveLength(POINTS.length);
  });

  it('takes a stage the author skipped off the map, with the route through its days', () => {
    const draft = answer(EMPTY_DRAFT, devonKey, 'skip');
    const content = deduceMapContent(halts(trip(), draft), draft, POINTS);
    expect(content.proposals.map((p) => p.key)).not.toContain(devonKey);
    expect(content.route.map((p) => p.date)).not.toContain('2025-11-05');
    expect(content.route.map((p) => p.date)).not.toContain('2025-11-06');
    expect(content.route.every((p) => p.lat < 0)).toBe(true);
  });

  it('keeps a skipped stage while it is the one looked at', () => {
    const draft = answer(EMPTY_DRAFT, devonKey, 'skip');
    const content = deduceMapContent(halts(trip(), draft), draft, POINTS, new Set([devonKey]));
    expect(content.proposals.map((p) => p.key)).toContain(devonKey);
    expect(content.route).toHaveLength(POINTS.length);
  });

  it('keeps a block skipped by the SAFE verb: those days are already the author’s stages', () => {
    const coast = createTripStage('Coral Coast', '', '2025-11-07', '2025-11-09', [createTripPlace('Exmouth')]);
    const ps = halts(trip([coast]));
    const inside = ps.find((p) => p.key === '2025-11-07..2025-11-09')!;
    expect(inside.verb).toBe('skip');
    expect(deduceMapContent(ps, EMPTY_DRAFT, POINTS).proposals).toContain(inside);
  });

  it('drops a place the author left out of a stage he keeps', () => {
    const whole = regions(trip()).find((p) => p.halts.length > 1)!;
    const out = whole.halts[whole.halts.length - 1];
    const draft = edit(EMPTY_DRAFT, whole, { halts: whole.halts.filter((h) => h !== out).map((h) => h.leg.startDate) });
    const ps = regions(trip(), draft);
    const content = deduceMapContent(ps, draft, POINTS);
    expect(content.proposals.map((p) => p.key)).toContain(whole.key);
    const left = new Set(content.route.map((p) => p.date));
    expect(left.has(out.leg.startDate)).toBe(false);
    expect(left.has(whole.halts[0].leg.startDate)).toBe(true);
    expect(content.route).toHaveLength(POINTS.length - out.leg.dayCount);
  });
});
