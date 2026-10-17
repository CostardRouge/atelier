import { describe, expect, it } from 'vitest';
import {
  cloneAtlas,
  createAtlasDoc,
  firstAtlas,
  flightIdOf,
  logsOf,
  readAtlasDoc,
  withFlights,
  withoutFlights,
  type AtlasFlightRef,
} from './atlas-doc';
import { sanitizeSettings } from './atlas-settings';

const hash = (c: string) => c.repeat(64);
const ref = (c: string, extra: Partial<AtlasFlightRef> = {}): AtlasFlightRef => ({ id: flightIdOf(hash(c)), name: `DJI_${c}`, log: hash(c), size: 10, ...extra });

describe('atlas documents', () => {
  it('derives a flight id from its log, so one log is one flight', () => {
    const doc = withFlights(createAtlasDoc('A', 'local'), [ref('a'), ref('a'), ref('b')]);
    expect(doc.flights.map((f) => f.id)).toEqual([flightIdOf(hash('a')), flightIdOf(hash('b'))]);
    expect(withFlights(doc, [ref('a')])).toBe(doc);
  });

  it('reads back a stored body, refusing what is not an atlas', () => {
    const doc = withFlights(createAtlasDoc('Perth', 'local'), [ref('a'), ref('b')]);
    const stored = JSON.parse(JSON.stringify({ ...doc, hidden: [doc.flights[1].id, 'nope'] }));
    const back = readAtlasDoc(stored, 'local');
    expect(back?.name).toBe('Perth');
    expect(back?.hidden).toEqual([doc.flights[1].id]);
    expect(readAtlasDoc({ ...stored, version: 99 }, 'local')).toBeNull();
    expect(readAtlasDoc({ name: 'x' }, 'local')).toBeNull();
    expect(readAtlasDoc({ ...stored, flights: [{ log: 'bad', name: 'x' }] }, 'local')?.flights).toEqual([]);
  });

  it('drops a removed flight from the hidden set and the spotlight picks', () => {
    let doc = withFlights(createAtlasDoc('A', 'local'), [ref('a'), ref('b')]);
    const id = doc.flights[0].id;
    doc = { ...doc, hidden: [id], settings: { ...doc.settings, camera: { ...doc.settings.camera, picked: [id] } } };
    const out = withoutFlights(doc, [id]);
    expect(out.flights).toHaveLength(1);
    expect(out.hidden).toEqual([]);
    expect(out.settings.camera.picked).toEqual([]);
  });

  it('clones under a new id with its own name and source', () => {
    const doc = withFlights(createAtlasDoc('A', 'local'), [ref('a')]);
    const copy = cloneAtlas(doc, { name: 'A (2)', sourceId: 'winnow.example' });
    expect(copy.id).not.toBe(doc.id);
    expect(copy.name).toBe('A (2)');
    expect(copy.sourceId).toBe('winnow.example');
    expect(copy.flights).toEqual(doc.flights);
    expect(copy.flights).not.toBe(doc.flights);
  });

  it('makes the first atlas from the remembered dials, carrying the picks onto the new ids', () => {
    const base = sanitizeSettings({});
    const settings = { ...base, hud: { ...base.hud, title: 'Guadeloupe' }, camera: { ...base.camera, picked: ['asset-1', 'gone'] } };
    const doc = firstAtlas(settings, [ref('a')], new Map([['asset-1', flightIdOf(hash('a'))]]), 'local');
    expect(doc.name).toBe('Guadeloupe');
    expect(doc.settings.camera.picked).toEqual([flightIdOf(hash('a'))]);
    expect(logsOf([doc])).toEqual(new Set([hash('a')]));
  });
});
