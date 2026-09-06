import { describe, expect, it } from 'vitest';
import {
  TRIP_DOC_VERSION,
  createTripDoc,
  createTripPost,
  type TripDoc,
} from './trip-types';
import {
  TRIP_FILE_KIND,
  parseTripFile,
  serializeTripFile,
  toTripFile,
  tripDocFromFile,
  tripFileName,
} from './trip-file';

const trip = (): TripDoc => {
  const doc = createTripDoc('Australie', 'Australia', '2025-07-01', '2025-07-10');
  const post = createTripPost('reel', '2025-07-03', 'Sunset over the gorge');
  return {
    ...doc,
    posts: [
      {
        ...post,
        title: 'Sunset over the gorge',
        projectId: 'studio-project-in-this-browser',
        media: { name: 'DJI_0001.MP4', size: 100, lastModified: 5, hash: 'abc' },
      },
    ],
  };
};

const roundTrip = (doc: TripDoc) => {
  const result = parseTripFile(serializeTripFile(toTripFile(doc)));
  if (!result.ok) throw new Error(result.error);
  return result.file;
};

describe('the trip file', () => {
  it('round-trips a trip through text', () => {
    const file = roundTrip(trip());
    expect(file.name).toBe('Australie');
    expect(file.destination).toBe('Australia');
    expect(file.startDate).toBe('2025-07-01');
    expect(file.endDate).toBe('2025-07-10');
    expect(file.posts).toHaveLength(1);
    expect(file.posts[0].title).toBe('Sunset over the gorge');
  });

  it('carries the media reference, hash included — that is how a trip finds its pictures elsewhere', () => {
    expect(roundTrip(trip()).posts[0].media).toEqual({
      name: 'DJI_0001.MP4',
      size: 100,
      lastModified: 5,
      hash: 'abc',
    });
  });

  it('drops projectId, which addresses a Studio project in THIS browser', () => {
    expect(roundTrip(trip()).posts[0].projectId).toBeNull();
  });

  it('never carries a sourceId — where a trip was KEPT is not part of the trip', () => {
    const doc = { ...trip(), sourceId: 'winnow.steeve.website' };
    const file = toTripFile(doc);
    expect(file).not.toHaveProperty('sourceId');
    expect(JSON.parse(serializeTripFile(file))).not.toHaveProperty('sourceId');
  });

  it('still reads a file written before the source existed (format 9)', () => {
    const file = { ...toTripFile(trip()), version: 9 } as Record<string, unknown>;
    const r = parseTripFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.version).toBe(TRIP_DOC_VERSION);
  });

  it('writes readable, newline-terminated JSON', () => {
    const text = serializeTripFile(toTripFile(trip()));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "kind": "atelier/road-trip"');
  });

  it('names the file from the trip, accents flattened', () => {
    expect(tripFileName('Été en Corse')).toBe('ete-en-corse.roadtrip.json');
    expect(tripFileName('  ')).toBe('trip.roadtrip.json');
  });
});

describe('parseTripFile — every rejection says something actionable', () => {
  it('rejects text that is not JSON', () => {
    const r = parseTripFile('not json at all');
    expect(r).toEqual({ ok: false, error: 'That file is not valid JSON.' });
  });

  it('rejects JSON that is not ours', () => {
    const r = parseTripFile('{"hello":"world"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('road-trip file');
  });

  it('refuses a file from a newer Atelier rather than half-reading it', () => {
    const file = { ...toTripFile(trip()), version: TRIP_DOC_VERSION + 1 };
    const r = parseTripFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('newer version');
  });

  it('refuses a trip with no dates — they are the spine of the model', () => {
    const file = { ...toTripFile(trip()), startDate: 'someday' };
    const r = parseTripFile(JSON.stringify(file));
    expect(r).toEqual({ ok: false, error: 'The file has no trip dates.' });
  });

  it('fills what an older file never wrote with the defaults a new trip gets', () => {
    const file: Record<string, unknown> = { ...toTripFile(trip()) };
    delete file.badgeWords;
    delete file.cta;
    delete file.hookDefaults;
    const r = parseTripFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const fresh = createTripDoc('x', 'y', '2025-07-01', '2025-07-10');
      expect(r.file.badgeWords).toEqual(fresh.badgeWords);
      expect(r.file.cta).toEqual(fresh.cta);
    }
  });

  it('strips a hand-edited projectId on the way in', () => {
    const file = toTripFile(trip());
    file.posts[0].projectId = 'smuggled';
    const r = parseTripFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.posts[0].projectId).toBeNull();
  });
});

describe('tripDocFromFile', () => {
  it('mints a fresh id, so importing twice gives two trips', () => {
    const file = roundTrip(trip());
    const a = tripDocFromFile(file);
    const b = tripDocFromFile(file);
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(trip().id);
  });

  it('stamps its own timestamps and carries the content across', () => {
    const doc = tripDocFromFile(roundTrip(trip()), 1234);
    expect(doc.createdAt).toBe(1234);
    expect(doc.updatedAt).toBe(1234);
    expect(doc.version).toBe(TRIP_DOC_VERSION);
    expect(doc.name).toBe('Australie');
    expect(doc.posts[0].media?.hash).toBe('abc');
    expect(doc.posts[0].projectId).toBeNull();
  });

  it('belongs to the source that imports it, this browser by default', () => {
    const file = roundTrip(trip());
    expect(tripDocFromFile(file).sourceId).toBe('local');
    expect(tripDocFromFile(file, 1, 'winnow.example').sourceId).toBe('winnow.example');
  });

  it('ignores a sourceId smuggled into the file', () => {
    const raw = { ...toTripFile(trip()), sourceId: 'somewhere.else' };
    const r = parseTripFile(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file).not.toHaveProperty('sourceId');
      expect(tripDocFromFile(r.file).sourceId).toBe('local');
    }
  });

  it('does not share structure with the file it came from', () => {
    const file = roundTrip(trip());
    const doc = tripDocFromFile(file);
    doc.posts[0].title = 'changed';
    expect(file.posts[0].title).toBe('Sunset over the gorge');
  });
});

describe('the file kind', () => {
  it('is stable — a stray .json is rejected on it', () => {
    expect(TRIP_FILE_KIND).toBe('atelier/road-trip');
    expect(toTripFile(trip()).kind).toBe(TRIP_FILE_KIND);
  });
});
