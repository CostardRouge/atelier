import { describe, expect, it } from 'vitest';
import { applySettings, openerOutline, openerTrips, recapOutline, withOpenerTripFile, withOpenerTripOf } from './recap-commands';
import { createRecapDoc, withPictures, type RecapDoc } from './recap-doc';
import { serializeTripFile, toTripFile } from '../roadtrip/trip-file';
import { createTripDoc, createTripPlace, createTripStage } from '../roadtrip/trip-types';
import { resolveRecap } from './recap-slots';

describe('recap commands', () => {
  const doc = withPictures(createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 }), [
    { key: 'a', origin: 'local', name: 'a.jpg', kind: 'photo', day: '2026-10-02', device: 'ILCE-7M4' },
    { key: 'sky', origin: 'local', name: 'sky.mp4', kind: 'video', day: '2026-10-03', loose: true },
  ]);

  it('writes known settings, deep, and says what changed', () => {
    const r = applySettings(doc, { format: 'square', cells: { gap: 0.02, count: true }, motion: { order: 'spiral' } }, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.format).toBe('square');
    expect(r.doc.cells.gap).toBe(0.02);
    expect(r.doc.cells.number).toBe(doc.cells.number);
    expect(r.doc.motion.order).toBe('spiral');
    expect(r.changed).toEqual(['format', 'cells.gap', 'cells.count', 'motion.order']);
  });

  it('refuses an unknown key and an out-of-range value, never clamping', () => {
    expect(applySettings(doc, { colour: 'red' })).toEqual({ ok: false, error: expect.stringContaining('unknown setting "colour"') });
    expect(applySettings(doc, { cells: { gap: 0.5 } })).toEqual({ ok: false, error: expect.stringContaining('cells.gap: 0.5') });
    expect(applySettings(doc, { motion: { order: 'sideways' } }).ok).toBe(false);
    expect(applySettings(doc, { pictures: [] }).ok).toBe(false);
    expect(applySettings(doc, 'x').ok).toBe(false);
  });

  it('outlines a recap for an agent, its loose clip out of the pool', () => {
    const o = recapOutline(doc, resolveRecap(doc), 1, 7.5, { 'ILCE-7M4': 'Sony' });
    expect(o.pool).toBe(1);
    expect(o.filled).toBe(1);
    expect(o.slots[1]).toEqual({ slot: '2026-10-02', label: '2 October', day: '2026-10-02', picture: { key: 'a', name: 'a.jpg', kind: 'photo', device: 'Sony' }, candidates: 1 });
    expect(o.slots[2].picture).toBeNull();
  });
});

describe('what an agent writes a caption from, and when it goes out', () => {
  it('gathers the period, the stays in order, the cameras and the best pictures', async () => {
    const { createRecapDoc, withPictures } = await import('./recap-doc');
    const { resolveRecap } = await import('./recap-slots');
    const { recapFacts } = await import('./recap-commands');
    let doc = createRecapDoc('dump', 'local', { now: 1 });
    doc = { ...doc, range: { from: '2025-11-01', to: '2025-11-10' } };
    doc = withPictures(doc, [
      { key: 'a', origin: 'local', name: 'a', kind: 'photo', day: '2025-11-01', place: 'Hobart', device: 'ILCE-7M4' },
      { key: 'b', origin: 'local', name: 'b', kind: 'photo', day: '2025-11-02', place: 'Hobart', device: 'ILCE-7M4', fav: true },
      { key: 'c', origin: 'local', name: 'c', kind: 'video', day: '2025-11-05', place: 'Freycinet', device: 'iPhone 15 Pro' },
    ]);
    const f = recapFacts(doc, resolveRecap(doc));
    expect(f.period).toEqual({ from: '2025-11-01', to: '2025-11-05' });
    expect(f.places.route).toEqual(['Hobart', 'Freycinet']);
    expect(f.places.stays).toEqual([
      { place: 'Hobart', days: 2, from: '2025-11-01', to: '2025-11-02' },
      { place: 'Freycinet', days: 1, from: '2025-11-05', to: '2025-11-05' },
    ]);
    expect(f.devices[0]).toEqual({ name: 'ILCE-7M4', count: 2 });
    expect(f.shown[0]).toMatchObject({ key: 'b', fav: true });
    expect(f.words.tags).toContain('#hobart');
    expect(f.caption).toMatchObject({ approved: false, custom: false });
  });

  it('reads when a post goes out: the next free slot, now, a draft, a wall clock in the rhythm’s zone', async () => {
    const { scheduleTarget } = await import('./recap-commands');
    const { DEFAULT_RHYTHM } = await import('../sources/postiz/rhythm');
    const now = new Date('2026-11-08T20:00:00Z');
    expect(scheduleTarget(undefined, DEFAULT_RHYTHM, [], now)).toEqual({ at: new Date('2026-11-10T08:00:00.000Z') });
    expect(scheduleTarget('now', DEFAULT_RHYTHM, [], now)).toEqual({ at: 'now' });
    expect(scheduleTarget('2026-11-12T18:30', DEFAULT_RHYTHM, [], now)).toEqual({ at: new Date('2026-11-12T17:30:00.000Z') });
    expect(scheduleTarget('2026-11-12T18:30:00Z', DEFAULT_RHYTHM, [], now)).toEqual({ at: new Date('2026-11-12T18:30:00.000Z') });
    expect(scheduleTarget('2026-11-01T10:00', DEFAULT_RHYTHM, [], now)).toMatchObject({ error: expect.stringMatching(/past/) });
    expect(scheduleTarget('tomorrow', DEFAULT_RHYTHM, [], now)).toMatchObject({ error: expect.stringMatching(/not a time/) });
  });
});

describe('the pool an agent browses, and the carousel it sets', () => {
  it('lists every picture, filtered, with its key, Winnow id and where it shows', async () => {
    const { createRecapDoc, withPictures } = await import('./recap-doc');
    const { resolveRecap } = await import('./recap-slots');
    const { poolList, winnowIdOf } = await import('./recap-commands');
    let doc = createRecapDoc('month', 'local', { anchor: '2025-07-01', now: 1 });
    doc = withPictures(doc, [
      { key: 'w:winnow.example:12', origin: 'winnow', name: 'IMG_12', kind: 'photo', day: '2025-07-14', minute: 1140, place: 'Cape Tribulation', region: 'Queensland', fav: true },
      { key: 'w:winnow.example:13', origin: 'winnow', name: 'IMG_13', kind: 'photo', day: '2025-07-14', minute: 600, place: 'Cape Tribulation', region: 'Queensland' },
      { key: 'w:winnow.example:20', origin: 'winnow', name: 'IMG_20', kind: 'video', day: '2025-07-20', place: 'Cairns', device: 'iPhone 15 Pro' },
    ]);
    const r = resolveRecap(doc);
    const all = poolList(doc, r, {});
    expect(all.total).toBe(3);
    expect(all.pictures.map((p) => p.key)).toEqual(['w:winnow.example:13', 'w:winnow.example:12', 'w:winnow.example:20']);
    expect(all.pictures[1]).toMatchObject({ winnowId: 12, time: '19:00', place: 'Cape Tribulation', fav: true, shownOn: ['2025-07-14'] });
    expect(all.pictures[0].shownOn).toBeUndefined();
    expect(poolList(doc, r, { place: 'queens', fav: true }).pictures.map((p) => p.winnowId)).toEqual([12]);
    expect(poolList(doc, r, { kind: 'video', device: 'iphone' }).matching).toBe(1);
    expect(poolList(doc, r, { shown: false }).pictures.map((p) => p.winnowId)).toEqual([13]);
    expect(poolList(doc, r, { day: '2025-07-20' }).matching).toBe(1);
    expect(winnowIdOf('local:abc')).toBeNull();
  });

  it('sets the carousel in his order, frozen — or says why not', async () => {
    const { createRecapDoc, withPictures } = await import('./recap-doc');
    const { chooseCarousel } = await import('./recap-commands');
    let dump = createRecapDoc('dump', 'local', { now: 1 });
    dump = withPictures(dump, ['a', 'b', 'c'].map((k) => ({ key: k, origin: 'local' as const, name: k, kind: 'photo' as const, day: '2025-07-01' })));
    const r = chooseCarousel(dump, ['c', 'a']);
    expect(r.ok && r.doc.carousel.chosen).toEqual(['c', 'a']);
    expect(chooseCarousel(dump, ['z'])).toMatchObject({ ok: false, error: expect.stringMatching(/not in this recap/) });
    expect(chooseCarousel(dump, ['a', 'a'])).toMatchObject({ ok: false, error: expect.stringMatching(/twice/) });
    const single = createRecapDoc('single', 'local', { now: 1 });
    expect(chooseCarousel(single, ['a'])).toMatchObject({ ok: false, error: expect.stringMatching(/no carousel/) });
  });
});

describe('the trip an agent gives a recap’s opener', () => {
  const trip = (id: string, name: string, from: string, to: string, updatedAt: number) => {
    const t = createTripDoc(name, from as never, to as never);
    t.stages = [createTripStage('Leg', '', from as never, to as never, [createTripPlace('A', '', { lat: -35, lon: 117 }), createTripPlace('B', '', { lat: -32, lon: 116 })])];
    return { ...t, id, updatedAt };
  };
  const trips = [trip('tas', 'Tasmania', '2026-02-12', '2026-02-26', 9), trip('wa', 'West coast', '2026-10-01', '2026-10-20', 3)];
  const month = () => createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
  const DAYS = ['2026-10-01', '2026-10-31'];

  it('lists this device’s trips, the covering one first, the kept one marked', () => {
    expect(openerTrips(month(), trips, DAYS).map((t) => [t.id, t.covers, t.kept, t.places])).toEqual([['wa', true, false, 2], ['tas', false, false, 2]]);
    const r = withOpenerTripOf(month(), trips, 'wa', 50);
    expect(r.ok && r.kept).toMatchObject({ from: 'trips', name: 'West coast', places: 2, road: false });
    const doc = (r as { doc: RecapDoc }).doc;
    expect(doc.opener.tripAuto).toBe(false);
    expect(openerTrips(doc, trips, DAYS)[0]).toMatchObject({ id: 'wa', kept: true });
    // Changed in Trips since the copy: said, never followed by itself.
    expect(openerTrips(doc, [trips[0], { ...trips[1], updatedAt: 4 }], DAYS)[0].changedSince).toBe(true);
  });

  it('reads the opener without its road, drops the copy on «none», and refuses what is no trip', () => {
    const r = withOpenerTripOf(month(), trips, 'wa', 50) as { doc: RecapDoc };
    const out = openerOutline(r.doc.opener);
    expect('tripCopy' in out).toBe(false);
    expect(out.tripKept).toMatchObject({ name: 'West coast', days: 20 });
    const none = withOpenerTripOf(r.doc, trips, 'none');
    expect(none.ok && none.kept).toBeNull();
    expect(none.ok && none.doc.opener).toMatchObject({ tripCopy: null, tripAuto: false });
    const missing = withOpenerTripOf(month(), trips, 'nope');
    expect(!missing.ok && missing.error).toMatch(/recap\.openerTrips/);
    const file = withOpenerTripFile(month(), serializeTripFile(toTripFile(trips[0])), 'tas.roadtrip.json', 5);
    expect(file.ok && file.kept).toMatchObject({ from: 'file', name: 'Tasmania' });
    expect(withOpenerTripFile(month(), '{"a":1}', 'x.json').ok).toBe(false);
    // A variant's own settings travel through recap.set like any other: kept as written, an unknown variant left out.
    const set = applySettings(r.doc, { opener: { kind: 'drive', options: { drive: { secondsPerPicture: 1.2 } } } });
    expect(set.ok && set.doc.opener.options.drive).toEqual({ secondsPerPicture: 1.2 });
    expect(set.ok && set.doc.opener.tripCopy).not.toBeNull();
  });
});
