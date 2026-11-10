import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACES, dayMates, isPlaceByHand, knownPlaces, placeMarks, placeName, placeRuns, placeWords, readPlaces, routeLine, tripPlaceFacts, withPlaceByHand, writtenPlace } from './recap-places';
import { createRecapDoc, readRecapDoc, withPictures } from './recap-doc';

const cells = (...places: (string | null)[]) => places.map((place, i) => ({ id: `c${i}`, place }));

describe('the recap’s places', () => {
  it('reads its settings, off until asked', () => {
    expect(readPlaces(undefined)).toEqual(DEFAULT_PLACES);
    expect(DEFAULT_PLACES).toMatchObject({ cells: 'off', runs: false, corner: 'bottomLeft', titlePin: true });
    expect(readPlaces({ cells: 'every', corner: 'topRight', runs: true, titlePin: false })).toEqual({ cells: 'every', corner: 'topRight', runs: true, titlePin: false, writing: 'name', country: 'never' });
    expect(readPlaces({ cells: 'all', corner: 'middle', runs: 'yes' })).toEqual(DEFAULT_PLACES);
  });

  it('names a picture by its town, else its region, else its country', () => {
    expect(placeName({ place: 'Albany', region: 'Western Australia', country: 'Australia' })).toBe('Albany');
    expect(placeName({ region: 'Western Australia', country: 'Australia' })).toBe('Western Australia');
    expect(placeName({ place: '  ', country: 'Australia' })).toBe('Australia');
    expect(placeName({})).toBeNull();
    expect(placeName(null)).toBeNull();
  });

  it('marks where the place changes, every cell, or the first of each place', () => {
    const route = cells('Esperance', 'Esperance', null, 'Albany', 'Albany', 'Esperance');
    expect([...placeMarks(route, 'off').keys()]).toEqual([]);
    // A cell with no place breaks nothing: Albany follows Esperance.
    expect([...placeMarks(route, 'changes').entries()]).toEqual([['c0', 'Esperance'], ['c3', 'Albany'], ['c5', 'Esperance']]);
    expect([...placeMarks(route, 'every').keys()]).toEqual(['c0', 'c1', 'c3', 'c4', 'c5']);
    expect([...placeMarks(route, 'first').keys()]).toEqual(['c0', 'c3']);
  });

  it('marks a cell once, though it lies on two slides', () => {
    expect([...placeMarks([{ id: 'n:1', place: 'Perth' }, { id: 'n:1', place: 'Perth' }, { id: 'n:2', place: 'Perth' }], 'every').keys()]).toEqual(['n:1', 'n:2']);
  });

  it('counts the place most visited by days, and the route in time order', () => {
    const w = placeWords([
      { day: '2026-10-01', place: 'Esperance' },
      { day: '2026-10-01', place: 'Esperance' },
      { day: '2026-10-01', place: 'Esperance' },
      { day: '2026-10-02', place: 'Albany', minute: 600 },
      { day: '2026-10-03', place: 'Albany' },
      { day: '2026-10-02', place: 'Esperance', minute: 480 },
      { day: '2026-10-04' },
      { day: '2026-10-05', place: 'Perth' },
    ]);
    // Albany and Esperance both have two days; Esperance has more pictures.
    expect(w.place).toBe('Esperance');
    expect(w.route).toEqual(['Esperance', 'Albany', 'Perth']);
    expect(placeWords([{ day: '2026-10-01' }])).toEqual({ place: null, route: [], written: null });
  });

  it('says a long route by its head and its end', () => {
    expect(routeLine(['A', 'B', 'C'])).toBe('A → B → C');
    expect(routeLine(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A → B → C → … → F');
    expect(routeLine([])).toBe('');
  });

  it('finds the runs of days, a day without a place joining the run around it only', () => {
    expect(placeRuns(['Esperance', null, 'Esperance', 'Albany', null, 'Perth', 'Perth'])).toEqual([
      { place: 'Esperance', from: 0, to: 2 },
      { place: 'Albany', from: 3, to: 3 },
      { place: 'Perth', from: 5, to: 6 },
    ]);
    expect(placeRuns([null, null])).toEqual([]);
  });
});

describe('how a place is written (lab 17, part III)', () => {
  const albany = { place: 'Albany', region: 'Western Australia', country: 'Australia' };
  it('writes it as Trips does, with the official code, degrading where a fact is missing', () => {
    expect(writtenPlace(albany, 'name')).toBe('Albany');
    expect(writtenPlace(albany, 'code')).toBe('Albany, WA');
    expect(writtenPlace(albany, 'full')).toBe('Albany, Western Australia');
    expect(writtenPlace(albany, 'paren')).toBe('Albany (WA)');
    expect(writtenPlace({ place: 'Albany' }, 'code')).toBe('Albany');
    expect(writtenPlace({ region: 'Bali', country: 'Indonesia' }, 'code')).toBe('Bali');
    expect(writtenPlace(null, 'code')).toBeNull();
  });

  it('says the country never, after a border, or always — old documents read as before', () => {
    expect(readPlaces({ cells: 'every' })).toMatchObject({ writing: 'name', country: 'never' });
    expect(readPlaces({ writing: 'code', country: 'changes' })).toMatchObject({ writing: 'code', country: 'changes' });
    const cells = [
      { id: 'a', place: 'Albany', written: 'Albany, WA', country: 'Australia' },
      { id: 'b', place: 'Perth', written: 'Perth, WA', country: 'Australia' },
      { id: 'c', place: 'Denpasar', written: 'Denpasar, Bali', country: 'Indonesia' },
    ];
    expect([...placeMarks(cells, 'every').values()]).toEqual(['Albany, WA', 'Perth, WA', 'Denpasar, Bali']);
    expect([...placeMarks(cells, 'every', 'changes').values()]).toEqual(['Albany, WA · Australia', 'Perth, WA', 'Denpasar, Bali · Indonesia']);
    expect([...placeMarks(cells, 'every', 'always').values()]).toEqual(['Albany, WA · Australia', 'Perth, WA · Australia', 'Denpasar, Bali · Indonesia']);
  });

  it('{place} follows the writing; the route stays bare names', () => {
    const w = placeWords([{ day: '2026-10-01', ...albany }, { day: '2026-10-02', place: 'Perth', region: 'Western Australia' }], 'code');
    expect(w.written).toBe('Albany, WA');
    expect(w.route).toEqual(['Albany', 'Perth']);
  });
});

describe('a place by hand', () => {
  const doc = () =>
    withPictures(createRecapDoc('month', 'local', { anchor: '2026-11-01', now: 1 }), [
      { key: 'a', origin: 'local', name: 'a.jpg', kind: 'photo', day: '2026-11-12' },
      { key: 'b', origin: 'local', name: 'b.jpg', kind: 'photo', day: '2026-11-12' },
      { key: 'c', origin: 'local', name: 'c.jpg', kind: 'photo', day: '2026-11-12', place: 'Albany', region: 'Western Australia', country: 'Australia' },
      { key: 'd', origin: 'local', name: 'd.jpg', kind: 'photo', day: '2026-11-13' },
    ]);

  it('is written in the place fields, Winnow’s kept to give back, and travels through a reload', () => {
    const set = withPlaceByHand(doc(), ['a'], { place: 'Albany', region: 'Western Australia', country: 'Australia' }, 2);
    const a = set.pictures.find((p) => p.key === 'a')!;
    expect(a).toMatchObject({ place: 'Albany', region: 'Western Australia', country: 'Australia', placeWinnow: {} });
    expect(isPlaceByHand(a)).toBe(true);
    expect(readRecapDoc(JSON.parse(JSON.stringify(set)), 'local')!.pictures.find((p) => p.key === 'a')!.placeWinnow).toEqual({});
    // A second hand place keeps the ORIGINAL; ↺ gives it back.
    const corrected = withPlaceByHand(set, ['c'], { place: 'Denmark', region: 'Western Australia' }, 3);
    expect(corrected.pictures.find((p) => p.key === 'c')).toMatchObject({ place: 'Denmark', placeWinnow: { place: 'Albany', region: 'Western Australia', country: 'Australia' } });
    const again = withPlaceByHand(withPlaceByHand(corrected, ['c'], { place: 'Torbay' }, 4), ['c'], null, 5);
    expect(again.pictures.find((p) => p.key === 'c')).toMatchObject({ place: 'Albany', country: 'Australia' });
    expect(isPlaceByHand(again.pictures.find((p) => p.key === 'c')!)).toBe(false);
    // Nothing said: nothing changes.
    const d = doc();
    expect(withPlaceByHand(d, ['a'], { place: '  ' }, 6)).toBe(d);
  });

  it('reaches only the day’s pictures with no place, and offers the places the recap knows', () => {
    const set = withPlaceByHand(doc(), ['a'], { place: 'Albany', region: 'Western Australia', country: 'Australia' }, 2);
    expect(dayMates(set, 'a')).toEqual({ without: ['b'], same: [] });
    const both = withPlaceByHand(set, ['b'], { place: 'Albany', region: 'Western Australia', country: 'Australia' }, 3);
    expect(dayMates(both, 'a')).toEqual({ without: [], same: ['b'] });
    expect(knownPlaces(both.pictures).map((p) => p.place)).toEqual(['Albany']);
  });
});

describe('a trip’s places, offered to a picture', () => {
  it('names each once, with its state (else its stage’s region) and its country', () => {
    const stage = (region: string, places: { name: string; state: string; countryCode?: string }[]) => ({ region, places });
    const trip = { stages: [stage('Western Australia', [{ name: 'Albany', state: '', countryCode: 'AU' }, { name: 'Denmark', state: 'Western Australia', countryCode: 'AU' }]), stage('', [{ name: 'Albany', state: '' }, { name: ' ', state: '' }])] };
    expect(tripPlaceFacts(trip as never)).toEqual([
      { place: 'Albany', region: 'Western Australia', country: 'Australia' },
      { place: 'Denmark', region: 'Western Australia', country: 'Australia' },
      { place: 'Albany' },
    ]);
    expect(tripPlaceFacts(null)).toEqual([]);
  });
});
