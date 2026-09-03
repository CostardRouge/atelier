import { describe, expect, it } from 'vitest';
import {
  PLACE_RESULT_LIMIT,
  nominatimUrl,
  parsePlaceResults,
  regionFromDisplayName,
} from './geocode';

describe('nominatimUrl', () => {
  it('is the only URL this module can build — assert it in full', () => {
    expect(nominatimUrl('Kalbarri')).toBe(
      'https://nominatim.openstreetmap.org/search' +
        `?q=Kalbarri&format=jsonv2&addressdetails=0&limit=${PLACE_RESULT_LIMIT}`,
    );
  });

  it('escapes what the author typed instead of pasting it into a URL', () => {
    const url = nominatimUrl('Saint-Étienne & co / 100%');
    expect(url).toContain('q=Saint-%C3%89tienne+%26+co+%2F+100%25');
    expect(new URL(url).searchParams.get('q')).toBe('Saint-Étienne & co / 100%');
  });

  it('trims, so a stray space is not a different query', () => {
    expect(new URL(nominatimUrl('  Perth  ')).searchParams.get('q')).toBe('Perth');
  });

  it('never asks for fewer than one result', () => {
    expect(new URL(nominatimUrl('Perth', 0)).searchParams.get('limit')).toBe('1');
    expect(new URL(nominatimUrl('Perth', -4)).searchParams.get('limit')).toBe('1');
  });
});

describe('regionFromDisplayName', () => {
  it('drops the place itself and the postcode, keeping the outer two levels', () => {
    expect(
      regionFromDisplayName(
        'Kalbarri, Shire of Northampton, Western Australia, 6536, Australia',
      ),
    ).toBe('Western Australia, Australia');
  });

  it('copes with a display name that is only the place', () => {
    expect(regionFromDisplayName('Uluru')).toBe('');
  });

  it('copes with nothing at all', () => {
    expect(regionFromDisplayName('')).toBe('');
  });
});

describe('parsePlaceResults', () => {
  const row = {
    place_id: 1,
    name: 'Kalbarri',
    display_name: 'Kalbarri, Shire of Northampton, Western Australia, 6536, Australia',
    lat: '-27.7099',
    lon: '114.1650',
  };

  it('reads a real response', () => {
    expect(parsePlaceResults([row])).toEqual([
      {
        name: 'Kalbarri',
        region: 'Western Australia, Australia',
        lat: -27.7099,
        lon: 114.165,
      },
    ]);
  });

  it('falls back to the head of the display name when `name` is absent', () => {
    expect(parsePlaceResults([{ ...row, name: '  ' }])[0].name).toBe('Kalbarri');
  });

  it('accepts 0,0 — unlike a DJI fix, it is a real answer here', () => {
    expect(parsePlaceResults([{ ...row, lat: 0, lon: 0 }])).toHaveLength(1);
  });

  it('drops a row whose coordinates are missing or unreadable', () => {
    expect(parsePlaceResults([{ ...row, lat: undefined }])).toEqual([]);
    expect(parsePlaceResults([{ ...row, lon: 'nowhere' }])).toEqual([]);
  });

  it('drops a row outside the globe', () => {
    expect(parsePlaceResults([{ ...row, lat: '91' }])).toEqual([]);
    expect(parsePlaceResults([{ ...row, lon: '-181' }])).toEqual([]);
  });

  it('drops a row that names nothing', () => {
    expect(parsePlaceResults([{ lat: '1', lon: '2', display_name: '' }])).toEqual([]);
  });

  it('keeps the good rows of a mixed response', () => {
    const results = parsePlaceResults([{ ...row, lat: 'x' }, row, null, 'nonsense']);
    expect(results.map((r) => r.name)).toEqual(['Kalbarri']);
  });

  it('never throws on something that is not a list of rows', () => {
    expect(parsePlaceResults(null)).toEqual([]);
    expect(parsePlaceResults({ error: 'rate limited' })).toEqual([]);
    expect(parsePlaceResults('<html>429</html>')).toEqual([]);
    expect(parsePlaceResults([])).toEqual([]);
  });
});
