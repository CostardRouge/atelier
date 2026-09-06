import { describe, expect, it } from 'vitest';
import {
  TRIP_DOC_VERSION,
  createTripDoc,
  createTripPlace,
  createTripPost,
  createTripStage,
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

  it('never writes sourceId — an imported trip belongs to the source that imports it', () => {
    const doc = { ...trip(), sourceId: 'winnow.example' };
    expect('sourceId' in toTripFile(doc)).toBe(false);
    expect(serializeTripFile(toTripFile(doc))).not.toContain('sourceId');
  });

  it('carries a stage origin — the one pointer outside the browser, kept on purpose', () => {
    const doc = trip();
    doc.stages = [
      {
        ...createTripStage('', '', '2025-07-02', '2025-07-04', [createTripPlace('Kalbarri')]),
        origin: { sourceId: 'winnow.example', chapterId: '42', importedAt: 1 },
      },
    ];
    expect(roundTrip(doc).stages[0].origin).toEqual({
      sourceId: 'winnow.example',
      chapterId: '42',
      importedAt: 1,
    });
  });

  it('carries the grade, a custom .cube as text inside its layer', () => {
    const doc = trip();
    doc.grade = {
      layers: [
        { id: 'l1', source: 'builtin:dji-d-log-to-rec709', name: 'D-Log', customText: null, intensity: 1, enabled: true },
        { id: 'l2', source: 'custom', name: 'mine.cube', customText: 'TITLE "mine"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n', intensity: 0.6, enabled: false },
      ],
      output: 'rec709-to-srgb',
    };
    doc.posts[0].grade = { layers: [], output: 'none' };
    const file = roundTrip(doc);
    expect(file.grade).toEqual(doc.grade);
    expect(file.posts[0].grade).toEqual({ layers: [], output: 'none' });
    expect(tripDocFromFile(file).grade).toEqual(doc.grade);
  });

  it('lands a file written before grades existed on an empty grade', () => {
    const file = { ...toTripFile(trip()), version: 9 } as Record<string, unknown>;
    delete file.grade;
    (file.posts as Record<string, unknown>[]).forEach((p) => delete p.grade);
    const r = parseTripFile(JSON.stringify(file));
    if (!r.ok) throw new Error(r.error);
    expect(r.file.grade).toEqual({ layers: [], output: 'none' });
    expect(r.file.posts[0].grade).toBeNull();
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

  it('ignores a hand-edited sourceId on the way in', () => {
    const file = { ...toTripFile(trip()), sourceId: 'smuggled.example' };
    const r = parseTripFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('sourceId' in r.file).toBe(false);
      expect(tripDocFromFile(r.file).sourceId).toBe('local');
    }
  });

  it('reads a file written before the document had a source', () => {
    const file = { ...toTripFile(trip()), version: 9 };
    const r = parseTripFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.version).toBe(TRIP_DOC_VERSION);
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

  it('does not share structure with the file it came from', () => {
    const file = roundTrip(trip());
    const doc = tripDocFromFile(file);
    doc.posts[0].title = 'changed';
    expect(file.posts[0].title).toBe('Sunset over the gorge');
  });

  it('belongs to the source that imports it — this browser by default', () => {
    const file = roundTrip(trip());
    expect(tripDocFromFile(file).sourceId).toBe('local');
    expect(tripDocFromFile(file, 1, 'winnow.example').sourceId).toBe('winnow.example');
  });
});

describe('the file kind', () => {
  it('is stable — a stray .json is rejected on it', () => {
    expect(TRIP_FILE_KIND).toBe('atelier/road-trip');
    expect(toTripFile(trip()).kind).toBe(TRIP_FILE_KIND);
  });
});
