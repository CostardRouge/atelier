import { describe, expect, it } from 'vitest';
import { serializeTripFile, toTripFile } from '../roadtrip/trip-file';
import { createTripDoc, createTripPlace, createTripPost, createTripStage, TRIP_DOC_VERSION } from '../roadtrip/trip-types';
import { createRecapDoc, readRecapDoc, withRecap } from './recap-doc';
import { readOpener } from './recap-opener';
import { OPENER_TRIP_ID, blankTrip, openerTripFrom, openerTripFromText, orderTrips, readOpenerTrip, tripFacts, tripMeta, tripOf, tripOverlap, tripSpan, tripStale, tripTrace, withTripEdit } from './recap-opener-trip';

const trip = () => {
  const t = createTripDoc('West coast', '2026-10-01', '2026-10-20');
  t.stages = [
    createTripStage('South', 'Western Australia', '2026-10-01', '2026-10-10', [createTripPlace('Albany', 'WA', { lat: -35.02, lon: 117.88 }), createTripPlace('Esperance', 'WA', { lat: -33.86, lon: 121.89 }), createTripPlace('Somewhere', 'WA', null)]),
    createTripStage('North', 'Western Australia', '2026-10-11', '2026-10-20', [createTripPlace('Perth', 'WA', { lat: -31.95, lon: 115.86 })]),
  ];
  t.posts = [createTripPost('reel', '2026-10-03', 'A day')];
  t.updatedAt = 100;
  return t;
};

describe('the trip a recap’s opener keeps', () => {
  it('copies what an opener reads and leaves the trip’s pieces behind', () => {
    const copy = openerTripFrom(trip(), 500);
    expect(copy.from).toEqual({ kind: 'trips', id: expect.any(String), updatedAt: 100 });
    expect(copy.importedAt).toBe(500);
    expect(copy.file.posts).toEqual([]);
    expect(copy.file.stages.map((s) => s.places.length)).toEqual([3, 1]);
    const back = tripOf(copy)!;
    expect(back.id).toBe(OPENER_TRIP_ID);
    expect(back.name).toBe('West coast');
    expect(back.stages[1].places[0].name).toBe('Perth');
    // Read once: the same document for the same copy.
    expect(tripOf(copy)).toBe(back);
  });

  it('reads a `.roadtrip.json`, and says why another file is not one', () => {
    const read = openerTripFromText(serializeTripFile(toTripFile(trip())), 'west-coast.roadtrip.json', 7);
    expect(read.ok && read.trip.from).toEqual({ kind: 'file', name: 'west-coast.roadtrip.json' });
    expect(read.ok && read.trip.file.posts).toEqual([]);
    expect(read.ok && tripOf(read.trip)?.stages.length).toBe(2);
    const not = openerTripFromText('{"hello": 1}', 'x.json');
    expect(not.ok).toBe(false);
    expect(!not.ok && not.error.length).toBeGreaterThan(5);
    expect(openerTripFromText('not json', 'x.json').ok).toBe(false);
    const newer = openerTripFromText(JSON.stringify({ ...toTripFile(trip()), version: TRIP_DOC_VERSION + 1 }), 'x.json');
    expect(newer.ok).toBe(false);
  });

  it('travels in the recap’s document, kept by reference, and drops what does not read', () => {
    const copy = openerTripFrom(trip(), 500);
    expect(readOpenerTrip(copy)).toBe(copy);
    const round = readOpenerTrip(JSON.parse(JSON.stringify(copy)))!;
    expect(tripOf(round)?.name).toBe('West coast');
    expect(readOpenerTrip(null)).toBeNull();
    expect(readOpenerTrip({ file: { kind: 'other' } })).toBeNull();
    expect(readOpenerTrip({ ...copy, file: { ...copy.file, version: TRIP_DOC_VERSION + 1 } })).toBeNull();
    // A copy whose origin was lost is still a trip.
    expect(readOpenerTrip({ file: copy.file })?.from).toEqual({ kind: 'own' });
    // A copy that passes the reader's look but is damaged is read as the trip file reader reads it: mended, never thrown.
    expect(tripOf({ from: { kind: 'own' }, importedAt: 0, file: { ...copy.file, stages: 'x' } as never })?.stages).toEqual([]);
    const doc = withRecap(createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 }), { opener: { ...readOpener({ kind: 'drive' }), tripCopy: copy, options: { drive: { trail: false } } } });
    const read = readRecapDoc(JSON.parse(JSON.stringify(doc)), 'local')!;
    expect(read.opener.kind).toBe('drive');
    expect(read.opener.options).toEqual({ drive: { trail: false } });
    expect(tripOf(read.opener.tripCopy!)?.stages.length).toBe(2);
    // A recap made before lab 16 has no copy and takes one by itself; «Use no trip» is kept.
    expect(readOpener({ kind: 'drive', trip: 'abc' })).toMatchObject({ trip: 'abc', tripCopy: null, tripAuto: true, options: {} });
    expect(readOpener({ kind: 'drive', tripAuto: false }).tripAuto).toBe(false);
    expect(readOpener({ kind: 'showcase' }).kind).toBe('showcase');
    expect(readOpener({ options: { drive: 3, warp: {}, card: { cardFace: 'ticket' } } }).options).toEqual({ card: { cardFace: 'ticket' } });
  });

  it('an edit made here lands in the copy, where it came from unchanged', () => {
    const copy = openerTripFrom(trip(), 500);
    const next = withTripEdit(copy, (t) => ({ ...t, name: 'Repainted' }), 900);
    expect(next).not.toBe(copy);
    expect(next.from).toEqual(copy.from);
    expect(tripOf(next)?.name).toBe('Repainted');
    expect(tripOf(copy)?.name).toBe('West coast');
    expect(withTripEdit(copy, (t) => t)).toBe(copy);
  });

  it('says a trip on a card: its span, its places, its road', () => {
    const f = tripFacts(trip());
    expect(f).toMatchObject({ name: 'West coast', days: 20, places: 3, road: false });
    expect(tripMeta(f)).toBe('3 places');
    expect(tripMeta({ ...f, places: 1, road: true })).toBe('1 place · road');
    expect(tripMeta({ ...f, places: 0 })).toBe('no place yet');
    expect(tripSpan('2026-10-01', '2026-10-20')).toBe('1 → 20 Oct 2026');
    expect(tripSpan('2026-09-03', '2026-11-28')).toBe('3 Sep → 28 Nov 2026');
    expect(tripSpan('2025-12-28', '2026-01-04')).toBe('28 Dec 2025 → 4 Jan 2026');
    expect(tripSpan('2026-10-01', '2026-10-01')).toBe('1 Oct 2026');
  });

  it('traces a trip’s places inside its thumbnail, north up', () => {
    const pts = tripTrace(trip(), 54, 36, 4);
    expect(pts.length).toBe(3);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(4);
      expect(p.x).toBeLessThanOrEqual(50);
      expect(p.y).toBeGreaterThanOrEqual(4);
      expect(p.y).toBeLessThanOrEqual(32);
    }
    // Perth is the most northern and the most western of the three.
    expect(pts[2].y).toBeLessThan(pts[0].y);
    expect(pts[2].x).toBeLessThan(pts[0].x);
    expect(tripTrace(createTripDoc('Empty', '2026-01-01', '2026-01-02'), 54, 36)).toEqual([]);
  });

  it('lists the trips covering the recap’s days first, then the latest touched', () => {
    const a = { ...trip(), id: 'a', updatedAt: 1 };
    const b = { ...createTripDoc('Tasmania', '2026-02-12', '2026-02-26'), id: 'b', updatedAt: 9 };
    const c = { ...createTripDoc('Morocco', '2025-05-02', '2025-05-19'), id: 'c', updatedAt: 5 };
    expect(tripOverlap(a, ['2026-10-01', '2026-10-31'])).toBe(20);
    expect(tripOverlap(b, ['2026-10-01', '2026-10-31'])).toBe(0);
    expect(orderTrips([c, b, a], ['2026-10-01', '2026-10-31']).map((x) => [x.trip.id, x.covers])).toEqual([['a', true], ['b', false], ['c', false]]);
  });

  it('knows a copy whose trip has changed in Trips since', () => {
    const t = { ...trip(), id: 'a' };
    const copy = openerTripFrom(t, 500);
    expect(tripStale(copy, [t])).toBe(false);
    expect(tripStale(copy, [{ ...t, updatedAt: 101 }])).toBe(true);
    expect(tripStale(copy, [])).toBe(false);
    expect(tripStale(null, [t])).toBe(false);
  });

  it('a recap with no trip is a trip of nothing over its days', () => {
    const own = blankTrip('October 2026', ['2026-10-31', '2026-10-01']);
    expect(own).toMatchObject({ id: OPENER_TRIP_ID, name: 'October 2026', startDate: '2026-10-01', endDate: '2026-10-31', stages: [] });
  });
});
