import { describe, expect, it } from 'vitest';
import {
  codeCandidates,
  datesOutsideStage,
  deriveStateCode,
  placeDates,
  placeStyleFor,
  placeText,
  rememberStateCode,
  stageRoute,
  stateCodeFor,
  statesOf,
  tableCode,
  writePlace,
} from './place-style';
import { createTripDoc, createTripPlace, createTripStage, type TripDoc } from './trip-types';

const trip = (codes: Record<string, string> = {}): TripDoc => ({
  ...createTripDoc('Australia', '2025-11-01', '2025-11-30'),
  stateCodes: codes,
});

describe('deriveStateCode', () => {
  it('takes the initials of several words, skipping the small ones', () => {
    expect(deriveStateCode('New South Wales')).toBe('NSW');
    expect(deriveStateCode('Western Australia')).toBe('WA');
    expect(deriveStateCode('Australian Capital Territory')).toBe('ACT');
    expect(deriveStateCode("Provence-Alpes-Côte d'Azur")).toBe('PACA');
  });

  it('is wrong where the official code keeps a small word or a syllable — which is why it is the last rung', () => {
    expect(deriveStateCode('Île-de-France')).toBe('IF'); // the official is IDF
    expect(deriveStateCode('Queensland')).toBe('QUE'); // QLD
  });

  it('takes three letters of a single word, and leaves a code alone', () => {
    expect(deriveStateCode('Bretagne')).toBe('BRE');
    expect(deriveStateCode('WA')).toBe('WA');
  });

  it('is empty for nothing', () => {
    expect(deriveStateCode('')).toBe('');
    expect(deriveStateCode('  of the ')).toBe('');
  });
});

describe('tableCode', () => {
  it('reads the trip’s table by the state’s name, forgiving case and accents', () => {
    const codes = { Queensland: 'QLD', 'Île-de-France': 'IDF' };
    expect(tableCode(codes, 'Queensland')).toBe('QLD');
    expect(tableCode(codes, ' queensland ')).toBe('QLD');
    expect(tableCode(codes, 'Ile-de-France')).toBe('IDF');
    expect(tableCode(codes, 'Victoria')).toBe('');
    expect(tableCode(codes, '')).toBe('');
  });
});

describe('stateCodeFor', () => {
  const qld = { state: 'Queensland', searchCode: 'QLD' };

  it('has no code without a state', () => {
    expect(stateCodeFor({ state: '' }, trip())).toEqual({ code: '', from: 'none' });
  });

  it('automatic order: own, then the table, then the search, then derived', () => {
    expect(stateCodeFor({ ...qld, stateCode: 'Q' }, trip({ Queensland: 'QL' }))).toEqual({ code: 'Q', from: 'own' });
    expect(stateCodeFor(qld, trip({ Queensland: 'QL' }))).toEqual({ code: 'QL', from: 'table' });
    expect(stateCodeFor(qld, trip())).toEqual({ code: 'QLD', from: 'search' });
    expect(stateCodeFor({ state: 'Queensland' }, trip())).toEqual({ code: 'QUE', from: 'derived' });
  });

  it('a pin wins over the automatic order — the author may prefer the search over their table', () => {
    const t = trip({ Queensland: 'QL' });
    expect(stateCodeFor({ ...qld, stateCode: 'Q', codeFrom: 'search' }, t)).toEqual({ code: 'QLD', from: 'search' });
    expect(stateCodeFor({ ...qld, stateCode: 'Q', codeFrom: 'table' }, t)).toEqual({ code: 'QL', from: 'table' });
    expect(stateCodeFor({ ...qld, stateCode: 'Q', codeFrom: 'own' }, t)).toEqual({ code: 'Q', from: 'own' });
  });

  it('a pin on a rung that went empty falls through instead of showing nothing', () => {
    expect(stateCodeFor({ ...qld, codeFrom: 'table' }, trip())).toEqual({ code: 'QLD', from: 'search' });
    expect(stateCodeFor({ state: 'Queensland', codeFrom: 'own' }, trip())).toEqual({ code: 'QUE', from: 'derived' });
  });

  it('lists every candidate, empty where the place has none', () => {
    expect(codeCandidates({ state: 'Queensland', searchCode: 'QLD' }, trip({ Queensland: 'QL' }))).toEqual({
      own: '',
      table: 'QL',
      search: 'QLD',
      derived: 'QUE',
    });
  });
});

describe('writePlace', () => {
  const sydney = { name: 'Sydney', state: 'New South Wales', searchCode: 'NSW' };

  it('writes the four styles', () => {
    expect(writePlace(sydney, 'code', trip())).toBe('Sydney, NSW');
    expect(writePlace(sydney, 'full', trip())).toBe('Sydney, New South Wales');
    expect(writePlace(sydney, 'paren', trip())).toBe('Sydney (NSW)');
    expect(writePlace(sydney, 'name', trip())).toBe('Sydney');
  });

  it('degrades to what the place has — never a dangling comma, never an invented code', () => {
    expect(writePlace({ name: 'Sydney', state: '' }, 'code', trip())).toBe('Sydney');
    expect(writePlace({ name: 'Sydney', state: '' }, 'full', trip())).toBe('Sydney');
    expect(writePlace({ name: '', state: 'New South Wales' }, 'code', trip())).toBe('');
    // A state the derivation cannot abbreviate falls back to the full name.
    expect(writePlace({ name: 'Perth', state: 'of' }, 'code', trip())).toBe('Perth, of');
  });

  it('reads the trip’s table when the place has no code of its own', () => {
    expect(writePlace({ name: 'Cairns', state: 'Queensland' }, 'code', trip({ Queensland: 'QLD' }))).toBe('Cairns, QLD');
    expect(writePlace({ name: 'Cairns', state: 'Queensland' }, 'code', trip())).toBe('Cairns, QUE');
  });
});

describe('placeStyleFor / placeText — the cascade', () => {
  const t = trip();
  const place = createTripPlace('Kalbarri', 'Western Australia');
  const stage = createTripStage('', '', '2025-11-05', '2025-11-09', [place]);

  it('falls to the trip’s writing for the surface', () => {
    expect(placeStyleFor(place, stage, t, 'badge')).toEqual({ style: 'name', from: 'trip' });
    expect(placeStyleFor(place, stage, t, 'lists')).toEqual({ style: 'code', from: 'trip' });
    expect(placeText(place, stage, t, 'badge')).toBe('Kalbarri');
    expect(placeText(place, stage, t, 'lists')).toBe('Kalbarri, WA');
  });

  it('a stage’s writing covers both surfaces, a place’s own wins over it', () => {
    const styled = { ...stage, placeStyle: 'full' as const };
    expect(placeStyleFor(place, styled, t, 'badge')).toEqual({ style: 'full', from: 'stage' });
    expect(placeText({ ...place, style: 'paren' }, styled, t, 'badge')).toBe('Kalbarri (WA)');
  });

  it('works with no stage at all', () => {
    expect(placeStyleFor(place, null, t, 'lists').from).toBe('trip');
  });
});

describe('stageRoute', () => {
  const t = trip({ Queensland: 'QLD' });
  const leg = (places: ReturnType<typeof createTripPlace>[], name = '') => createTripStage(name, '', '2025-11-02', '2025-11-10', places);

  it('is the author’s own name, or empty when the stage names nothing', () => {
    expect(stageRoute(leg([createTripPlace('Perth', 'Western Australia')], 'Coral Coast'), t, 'lists')).toBe('Coral Coast');
    expect(stageRoute(leg([]), t, 'lists')).toBe('');
  });

  it('writes one place, and says a shared state once over a route', () => {
    expect(stageRoute(leg([createTripPlace('Kalbarri', 'Western Australia')]), t, 'lists')).toBe('Kalbarri, WA');
    expect(stageRoute(leg([createTripPlace('Kalbarri', 'Western Australia'), createTripPlace('Exmouth', 'Western Australia')]), t, 'lists')).toBe('Kalbarri → Exmouth, WA');
    expect(stageRoute(leg([createTripPlace('Perth', 'Western Australia'), createTripPlace('Cairns', 'Queensland')]), t, 'lists')).toBe('Perth, WA → Cairns, QLD');
  });

  it('is today’s label on the badge, whose default writing is the name alone', () => {
    expect(stageRoute(leg([createTripPlace('Perth', 'Western Australia'), createTripPlace('Cairns', 'Queensland')]), t, 'badge')).toBe('Perth → Cairns');
    // A caller holding less than a document gets the defaults.
    expect(stageRoute(leg([createTripPlace('Perth', 'Western Australia')]), {}, 'lists')).toBe('Perth, WA');
  });
});

describe('statesOf / rememberStateCode', () => {
  it('lists the distinct states in the order they are met', () => {
    const t = trip();
    t.stages = [
      createTripStage('', '', '2025-11-02', '2025-11-10', [
        createTripPlace('Perth', 'Western Australia'),
        createTripPlace('Kalbarri', 'western australia'),
        createTripPlace('Somewhere'),
      ]),
      createTripStage('', '', '2025-11-11', '2025-11-20', [createTripPlace('Cairns', 'Queensland')]),
    ];
    expect(statesOf(t)).toEqual(['Western Australia', 'Queensland']);
  });

  it('writes one line, replaces a line spelt differently, and removes it when emptied', () => {
    let t = rememberStateCode(trip(), 'Queensland', 'QLD');
    expect(t.stateCodes).toEqual({ Queensland: 'QLD' });
    t = rememberStateCode(t, ' queensland ', 'QL');
    expect(t.stateCodes).toEqual({ queensland: 'QL' });
    t = rememberStateCode(t, 'Queensland', '  ');
    expect(t.stateCodes).toEqual({});
    expect(rememberStateCode(t, '', 'X').stateCodes).toEqual({});
  });
});

describe('placeDates / datesOutsideStage', () => {
  const stage = { startDate: '2025-11-05', endDate: '2025-11-09' };

  it('is nothing without a date, one day, or a span with the month said once', () => {
    expect(placeDates({})).toBe('');
    expect(placeDates({ arrived: '2025-11-10' })).toBe('10 Nov');
    expect(placeDates({ left: '2025-11-10' })).toBe('10 Nov');
    expect(placeDates({ arrived: '2025-11-07', left: '2025-11-07' })).toBe('7 Nov');
    expect(placeDates({ arrived: '2025-11-07', left: '2025-11-09' })).toBe('7–9 Nov');
    expect(placeDates({ arrived: '2025-11-28', left: '2025-12-02' })).toBe('28 Nov–2 Dec');
  });

  it('ignores a date that is not one', () => {
    expect(placeDates({ arrived: 'yesterday' })).toBe('');
  });

  it('says when either day lies outside the stage', () => {
    expect(datesOutsideStage({ arrived: '2025-11-06', left: '2025-11-09' }, stage)).toBe(false);
    expect(datesOutsideStage({ arrived: '2025-11-04' }, stage)).toBe(true);
    expect(datesOutsideStage({ arrived: '2025-11-06', left: '2025-11-10' }, stage)).toBe(true);
    expect(datesOutsideStage({}, stage)).toBe(false);
  });
});
