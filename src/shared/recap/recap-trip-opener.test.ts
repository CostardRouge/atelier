import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createTripDoc, createTripPlace, createTripStage } from '../roadtrip/trip-types';
import type { HookPickedPicture } from '../roadtrip/hooks/hook-variant';
import type { RecapPicture } from './recap-doc';
import { readOpener, TRIP_OPENERS, type RecapOpener } from './recap-opener';
import { openerTripFrom } from './recap-opener-trip';
import { lookOptions, pickedOf, planTripOpener, setupTripOpener, storedOptions, tripCovering, tripOpenerUnmet, withLookOptions } from './recap-trip-opener';

const pic = (key: string, day: string, lat?: number, lon?: number): RecapPicture => ({ key, origin: 'local', name: `${key}.jpg`, kind: 'photo', day, minute: 600, ...(lat !== undefined ? { lat, lon } : {}) });

const trip = () => {
  const t = createTripDoc('West coast', '2026-10-01', '2026-10-20');
  t.stages = [
    createTripStage('South', 'Western Australia', '2026-10-01', '2026-10-10', [createTripPlace('Albany', 'WA', { lat: -35.02, lon: 117.88 }), createTripPlace('Esperance', 'WA', { lat: -33.86, lon: 121.89 })]),
    createTripStage('North', 'Western Australia', '2026-10-11', '2026-10-20', [createTripPlace('Perth', 'WA', { lat: -31.95, lon: 115.86 })]),
  ];
  return t;
};
const DAYS = ['2026-10-01', '2026-10-31'];
const PICS = [pic('a', '2026-10-02', -35.02, 117.88), pic('b', '2026-10-06', -33.86, 121.89), pic('c', '2026-10-15', -31.95, 115.86), pic('d', '2026-11-30', -30, 115)];
const opener = (patch: Partial<RecapOpener> = {}): RecapOpener => ({ ...readOpener({}), tripCopy: openerTripFrom(trip(), 5), ...patch });
const still = () => ({ image: {} as CanvasImageSource, width: 100, height: 100 });

describe('a trip opener at the head of a recap', () => {
  it('finds the trip covering the most of the recap’s days, none when none does', () => {
    const a = trip();
    const b = createTripDoc('Before', '2026-09-01', '2026-10-02');
    expect(tripCovering([b, a], ['2026-10-01', '2026-10-15'])?.name).toBe('West coast');
    expect(tripCovering([a], ['2025-01-01', '2025-01-31'])).toBeNull();
    expect(tripCovering([a], [])).toBeNull();
  });

  it('reads a recap picture as one of Trips’ picked pictures, found again by its key', () => {
    expect(pickedOf(pic('w:nas:4', '2026-10-03', -35, 118))).toMatchObject({ ref: { assetId: 'w:nas:4' }, date: '2026-10-03', coords: { lat: -35, lon: 118 } });
    expect(pickedOf({ ...pic('x', '2026-10-03'), day: null })).toBeNull();
  });

  it('runs every one of Trips’ variants over the recap’s copy of a trip, painting a frame', () => {
    for (const kind of TRIP_OPENERS) {
      const setup = setupTripOpener({ kind, opener: opener(), pictures: PICS, days: DAYS, aspect: 9 / 16, best: 'a' })!;
      expect(setup.hasTrip, kind).toBe(true);
      expect(tripOpenerUnmet(setup), kind).toBeNull();
      const plan = planTripOpener(setup);
      expect(plan, kind).not.toBeNull();
      expect(plan!.seconds, kind).toBeGreaterThanOrEqual(1);
      expect(plan!.tripName).toBe('West coast');
      // A picture outside the trip is no stop; the card also draws the recap's best under it.
      if (kind === 'drive' || kind === 'map') expect(plan!.keys).toEqual(['a', 'b', 'c']);
      if (kind === 'card') expect(plan!.keys).toContain('a');
      expect(plan!.wantsGround()).toEqual([]);
      // Its still is its last frame — but a Virée's is taken before its map fades for what follows.
      expect(plan!.rest, kind).toBeLessThan(plan!.seconds);
      if (kind === 'drive') expect(plan!.seconds - plan!.rest).toBeGreaterThan(0.7);
      else expect(plan!.seconds - plan!.rest).toBeLessThan(0.05);
      const rec = recordingContext(1080, 1920);
      plan!.paint(rec.ctx, 1080, 1920, plan!.seconds / 2, still);
      expect(rec.ops.length, kind).toBeGreaterThan(5);
    }
  });

  it('starts where it was fixed before — and every start is a setting', () => {
    const drive = setupTripOpener({ kind: 'drive', opener: opener(), pictures: PICS, days: DAYS, aspect: 9 / 16 })!;
    expect(drive.options).toMatchObject({ summary: false, secondsPerPicture: 0.45, includePieces: false, stopsOn: 'pictures' });
    const map = setupTripOpener({ kind: 'map', opener: opener(), pictures: PICS, days: DAYS, aspect: 9 / 16 })!;
    expect(map.options).toMatchObject({ size: 1.1, plate: true });
    const slower = setupTripOpener({ kind: 'drive', opener: opener({ options: { drive: { secondsPerPicture: 1.2, summary: true } } }), pictures: PICS, days: DAYS, aspect: 9 / 16 })!;
    expect(slower.options).toMatchObject({ summary: true, secondsPerPicture: 1.2 });
    expect(planTripOpener(slower)!.seconds).toBeGreaterThan(planTripOpener(drive)!.seconds);
  });

  it('starts on eight located pictures for a drive, twelve for a map — his own choice wins', () => {
    const many = Array.from({ length: 20 }, (_, i) => pic(`p${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, -35 + i * 0.2, 117 + i * 0.2));
    const drive = setupTripOpener({ kind: 'drive', opener: opener(), pictures: many, days: DAYS, aspect: 9 / 16 })!;
    expect((drive.options.picked as HookPickedPicture[]).length).toBe(8);
    expect(setupTripOpener({ kind: 'map', opener: opener(), pictures: many, days: DAYS, aspect: 9 / 16 })!.auto.picked.length).toBe(12);
    const two = [pickedOf(many[3])!, pickedOf(many[9])!, pickedOf(pic('gone', '2026-10-04', 1, 1))!];
    const own = setupTripOpener({ kind: 'drive', opener: opener({ options: { drive: { picked: two } } }), pictures: many, days: DAYS, aspect: 9 / 16 })!;
    // A picture no longer on the recap is dropped from his choice.
    expect((own.options.picked as HookPickedPicture[]).map((p) => p.ref.assetId)).toEqual(['p3', 'p9']);
  });

  it('keeps a panel’s change without the stops the recap gives by itself', () => {
    const setup = setupTripOpener({ kind: 'drive', opener: opener(), pictures: PICS, days: DAYS, aspect: 9 / 16 })!;
    const kept = storedOptions(setup, { ...setup.options, secondsPerPicture: 1 });
    expect(kept.secondsPerPicture).toBe(1);
    expect('picked' in kept).toBe(false);
    expect('stopsOn' in kept).toBe(false);
    // His own stops, and a source he chose, are kept.
    const own = storedOptions(setup, { ...setup.options, stopsOn: 'places', picked: [pickedOf(PICS[0])!] });
    expect(own.stopsOn).toBe('places');
    expect((own.picked as unknown[]).length).toBe(1);
  });

  it('with no trip, two located pictures are a road and the default vehicle drives it', () => {
    const none = opener({ tripCopy: null });
    const setup = setupTripOpener({ kind: 'drive', opener: none, pictures: PICS, days: DAYS, aspect: 9 / 16, title: 'October 2026' })!;
    expect(setup.hasTrip).toBe(false);
    expect(tripOpenerUnmet(setup)).toBeNull();
    const plan = planTripOpener(setup)!;
    expect(plan.tripName).toBeNull();
    // Every located picture of the recap's days counts: there is no trip to be outside of.
    expect(plan.keys).toEqual(['a', 'b', 'c']);
    // The same trip of nothing while the recap's name and span hold.
    expect(setupTripOpener({ kind: 'map', opener: none, pictures: PICS, days: DAYS, aspect: 9 / 16, title: 'October 2026' })!.trip).toBe(setup.trip);
    // Vitrine needs no stop at all; the others say what is missing.
    const bare = [pic('x', '2026-10-02')];
    expect(tripOpenerUnmet(setupTripOpener({ kind: 'showcase', opener: none, pictures: bare, days: DAYS, aspect: 9 / 16 })!)).toBeNull();
    for (const kind of ['drive', 'map', 'card'] as const) {
      const s = setupTripOpener({ kind, opener: none, pictures: bare, days: DAYS, aspect: 9 / 16 })!;
      expect(tripOpenerUnmet(s), kind).toMatch(/Choose a trip/);
      expect(planTripOpener(s), kind).toBeNull();
    }
    expect(setupTripOpener({ kind: 'drive', opener: none, pictures: PICS, days: [], aspect: 9 / 16 })).toBeNull();
  });

  it('a kept style carries a variant’s look, never what was given to one recap', () => {
    const options = { drive: { secondsPerPicture: 1, picked: [pickedOf(PICS[0])!], stops: [{ id: 's' }], cardTitle: 'Mine' }, showcase: { place: 'beach', caption: 'Tanger Med' } };
    const look = lookOptions(options);
    expect(look.drive).toEqual({ secondsPerPicture: 1 });
    expect(look.showcase).toEqual({ place: 'beach' });
    const applied = withLookOptions({ drive: { secondsPerPicture: 0.3, cardTitle: 'Theirs', trail: false } }, look);
    expect(applied.drive).toEqual({ secondsPerPicture: 1, cardTitle: 'Theirs' });
    expect(applied.showcase).toEqual({ place: 'beach' });
  });
});
