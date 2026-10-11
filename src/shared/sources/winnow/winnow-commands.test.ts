import { describe, expect, it } from 'vitest';
import { askFromParams, cullingMark, filterAsk, keepAsk, readAssetQuery, readStatsSpan, resolveTown, resolveWho, rowSummary, winnowCommands } from './winnow-commands';
import type { GazetteerCity } from '../../roadtrip/gazetteer';
import type { WinnowAssetRow, WinnowClient, WinnowPerson } from './client';

const row = (over: Partial<WinnowAssetRow> = {}): WinnowAssetRow =>
  ({
    id: 7,
    filename: 'DSC0001.HIF',
    session_id: 3,
    ext: 'hif',
    media_type: 'photo',
    captured_at: '2026-09-14T08:12:00Z',
    capture_date: '2026-09-14',
    width: 7008,
    height: 4672,
    duration_s: null,
    file_size: 1,
    content_hash: null,
    gps_lat: -16.9,
    gps_lon: 145.7,
    camera_model: 'ILCE-7CM2',
    lens: 'FE 24-70',
    iso: 100,
    shutter: '1/250',
    aperture: 4,
    focal_length: 35,
    relative_altitude: null,
    absolute_altitude: null,
    derivative_status: 'ready',
    has_telemetry: false,
    sidecars: [],
    verdict: 'pick',
    star: 4,
    color_label: 'red',
    tags: ['reef'],
    group_kind: 'raw_jpeg',
    companion_ext: 'ARW',
    ...over,
  }) as WinnowAssetRow;

describe('readAssetQuery', () => {
  it('reads a span, a folder and the culling filters', () => {
    expect(readAssetQuery({ date: '2026-09-14', dateTo: '2026-09-15', verdict: 'pick', minStars: 3, tag: ' reef ', media: 'photo' })).toEqual({
      query: { dateFrom: '2026-09-14', dateTo: '2026-09-15', mediaType: 'photo', verdict: 'pick', minStars: 3 },
      filter: { verdict: 'pick', minStars: 3, tag: 'reef', media: 'photo' },
    });
    expect(readAssetQuery({ folder: 12 }).query).toEqual({ sessionId: 12 });
  });

  it('reads the people and face filters, and takes a person as a scope of its own', () => {
    expect(readAssetQuery({ people: [3, 5], together: true, faces: 'group' }).query).toEqual({
      people: [3, 5],
      together: true,
      faceCount: Array.from({ length: 29 }, (_, i) => i + 2),
    });
    expect(readAssetQuery({ date: '2026-09-14', faces: 'none' }).query).toMatchObject({ hasFaces: false });
    expect(readAssetQuery({ date: '2026-09-14', faces: 'solo' }).query).toMatchObject({ faceCount: [1] });
  });

  it('refuses a listing with neither a day nor a folder, and a span backwards', () => {
    expect(() => readAssetQuery({ verdict: 'pick' })).toThrow(/date .* folder id, people, words or a place/);
    expect(() => readAssetQuery({ date: '2026-09-15', dateTo: '2026-09-14' })).toThrow(/before/);
    expect(() => readAssetQuery({ dateTo: '2026-09-14' })).toThrow(/needs a date/);
  });

  it('reads a colour ask apart from the row filter', () => {
    expect(readAssetQuery({ date: '2026-09-14', colour: 'blue' })).toMatchObject({ colour: 'blue', filter: {} });
    expect(readAssetQuery({ date: '2026-09-14' }).colour).toBeUndefined();
  });

  it('takes words and a place as scopes of their own', () => {
    expect(readAssetQuery({ words: ' Uluru ' }).query).toEqual({ words: 'Uluru' });
    expect(readAssetQuery({ nearLat: -16.9, nearLon: 145.7, nearKm: 40 }).filter).toEqual({ near: { lat: -16.9, lon: 145.7, km: 40 } });
    expect(readAssetQuery({ near: 'Cairns' }).filter).toEqual({});
  });

  it('reads the moment into the filter', () => {
    expect(readAssetQuery({ date: '2026-09-14', time: 'morning', light: 'golden', gear: 'drone', camera: ' FC8482 ' }).filter).toEqual({
      hours: [5, 12],
      light: 'golden',
      gear: 'drone',
      camera: 'FC8482',
    });
  });
});

describe('filterAsk', () => {
  // 07:42 on the camera's wall clock in Cairns; 19:55 on the Sydney coast by
  // the place's offset (+11 h): 08:55 UTC, the sun low before it sets.
  const morning = row({ id: 1, captured_at: '2026-09-14T07:42:00Z', captured_at_source: 'exif-wall', capture_offset_min: 600, gps_lat: -16.9, gps_lon: 145.7 });
  const dusk = row({ id: 2, captured_at: '2026-01-01T08:55:00Z', captured_at_source: 'exif', capture_offset_min: 660, gps_lat: -33.87, gps_lon: 151.21, camera_model: 'FC8482' });
  const unknown = row({ id: 3, captured_at: '2026-09-14T09:00:00Z', captured_at_source: 'exif', capture_offset_min: null, exif_offset_min: null, gps_lat: null, camera_model: null });
  const rows = [morning, dusk, unknown];
  const ids = (f: Parameters<typeof filterAsk>[1]) => filterAsk(rows, f).map((r) => r.id);

  it('keeps the hours by the local clock, and drops a row whose hour cannot be told', () => {
    expect(ids({ hours: [5, 12] })).toEqual([1]);
    expect(ids({ hours: [18, 22] })).toEqual([2]);
  });

  it('keeps the light by the sun where it was taken, and the gear by the body', () => {
    expect(ids({ light: 'golden' })).toEqual([2]);
    expect(ids({ gear: 'drone' })).toEqual([2]);
    expect(ids({ gear: 'camera' })).toEqual([1]);
    expect(ids({ camera: 'ilce' })).toEqual([1]);
  });

  it('still applies the culling half', () => {
    expect(ids({ verdict: 'reject' })).toEqual([]);
  });
});

describe('rowSummary', () => {
  it('says what a person chooses by', () => {
    expect(rowSummary(row())).toMatchObject({
      id: 7,
      file: 'DSC0001.HIF',
      exposure: '1/250 s · ƒ4 · ISO 100 · 35 mm',
      size: '7008 × 4672',
      gps: [-16.9, 145.7],
      verdict: 'pick',
      stars: 4,
      label: 'red',
      tags: ['reef'],
      companion: 'pair · .ARW',
      folder: 3,
      gear: 'camera',
    });
  });

  it('says the local hour, the light and the gear when they can be told', () => {
    const s = rowSummary(row({ captured_at: '2026-01-01T08:55:00Z', captured_at_source: 'exif', capture_offset_min: 660, gps_lat: -33.87, gps_lon: 151.21, camera_model: 'FC8482' }));
    expect(s).toMatchObject({ local: '19:55', light: 'golden', gear: 'drone' });
  });

  it('reads a row with nothing culled as unrated, and no exposure as null', () => {
    const s = rowSummary(row({ verdict: undefined, star: undefined, color_label: undefined, shutter: null, aperture: null, iso: null, focal_length: null, gps_lat: null }));
    expect(s.verdict).toBe('unrated');
    expect(s.exposure).toBeNull();
    expect(s.gps).toBeNull();
  });
});

describe('cullingMark', () => {
  it('writes the verdict, the stars and the label, or nothing', () => {
    expect(cullingMark(row())).toBe('pick ★4 red');
    expect(cullingMark(row({ verdict: 'unrated', star: 0, color_label: null }))).toBeUndefined();
  });
});

describe('winnowCommands', () => {
  it('is unavailable with no instance connected', () => {
    const specs = winnowCommands({ winnow: () => ({ client: null, connection: null }), sheet: async () => ({}) as never });
    for (const s of specs) expect(s.available?.()).toMatch(/no Winnow is connected/);
  });
});

const people: WinnowPerson[] = [
  { id: 1, name: 'Lucie Martin', hidden: false, face_count: 40, asset_count: 30, cover_face_id: 11 },
  { id: 2, name: 'Lucas', hidden: false, face_count: 10, asset_count: 9, cover_face_id: 12 },
  { id: 3, name: null, hidden: false, face_count: 5, asset_count: 5, cover_face_id: 13 },
  { id: 4, name: 'Hidden', hidden: true, face_count: 1, asset_count: 1, cover_face_id: null },
];

describe('resolveWho', () => {
  it('finds a person by their name, case aside, or by a part only they carry', () => {
    expect(resolveWho(['lucas'], people)).toEqual([2]);
    expect(resolveWho(['Martin', 'LUCAS'], people)).toEqual([1, 2]);
    expect(resolveWho(['elodie'], [...people, { id: 5, name: 'Élodie', hidden: false, face_count: 1, asset_count: 1, cover_face_id: null }])).toEqual([5]);
  });

  it('refuses an ambiguous part, an unknown name and a hidden person', () => {
    expect(() => resolveWho(['Luc'], people)).toThrow(/names 2 people — "Lucie Martin" \(#1\), "Lucas" \(#2\)/);
    expect(() => resolveWho(['Paul'], people)).toThrow(/nobody is named "Paul"/);
    expect(() => resolveWho(['Hidden'], people)).toThrow(/nobody is named/);
  });
});

describe('askFromParams', () => {
  it('adds the people named in who to the ids given', async () => {
    const client = { people: async () => people } as unknown as WinnowClient;
    const ask = await askFromParams(client, { people: [3], who: ['lucas'], together: true, colour: 'warm', gear: 'drone' });
    expect(ask.query).toMatchObject({ people: [3, 2], together: true });
    expect(ask.colour).toBe('warm');
    expect(ask.filter).toEqual({ gear: 'drone' });
  });
});

describe('resolveTown', () => {
  const cities: GazetteerCity[] = [
    { name: 'Exmouth', country: 'AU', lat: -21.93, lon: 114.13, population: 2500, section: false, region: 'WA' } as GazetteerCity,
    { name: 'Exmouth', country: 'GB', lat: 50.62, lon: -3.41, population: 34000, section: false, region: 'Devon' } as GazetteerCity,
  ];
  it('takes the biggest town of that name and says which', () => {
    expect(resolveTown('exmouth', cities, 30)).toEqual({ near: { lat: 50.62, lon: -3.41, km: 30 }, town: { name: 'Exmouth', country: 'GB' } });
  });
  it('refuses a town the index does not know', () => {
    expect(() => resolveTown('Nowhere', cities, 25)).toThrow(/no town named "Nowhere"/);
  });
});

describe('keepAsk', () => {
  it('fetches nothing when no colour is asked', async () => {
    const client = { fetchFile: () => Promise.reject(new Error('must not fetch')) } as unknown as WinnowClient;
    const got = await keepAsk(client, 'w', [row({ id: 1 }), row({ id: 2, verdict: 'reject' })], { query: {}, filter: { verdict: 'pick' } });
    expect(got.kept.map((r) => r.id)).toEqual([1]);
    expect(got.analysed).toBe(0);
  });
});

describe('readStatsSpan', () => {
  it('reads a year or a span, and refuses half of one', () => {
    expect(readStatsSpan({ year: '2026' })).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(readStatsSpan({ from: '2026-01-01', to: '2026-02-01' })).toEqual({ from: '2026-01-01', to: '2026-02-01' });
    expect(() => readStatsSpan({ year: '26' })).toThrow(/YYYY/);
    expect(() => readStatsSpan({ year: '2026', from: '2026-01-01' })).toThrow(/not both/);
    expect(() => readStatsSpan({ from: '2026-01-01' })).toThrow(/give a year/);
    expect(() => readStatsSpan({ from: '2026-02-01', to: '2026-01-01' })).toThrow(/before/);
  });
});

