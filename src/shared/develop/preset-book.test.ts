import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import {
  bookToWire,
  createPresetBook,
  mergeBooks,
  mergeTripPresets,
  readPresetBook,
  removePresetFromBook,
  savePresetInBook,
  withIdentity,
} from './preset-book';

const light = (exposure: number) => ({ ...DEFAULT_DEVELOP, exposure });
const preset = (id: string, name: string, exposure = 0.5) => ({ id, name, settings: light(exposure) });

describe('the preset book', () => {
  it('starts empty, on this browser, having merged no trip', () => {
    expect(createPresetBook('b1', 10)).toEqual({
      id: 'b1',
      version: 1,
      sourceId: 'local',
      updatedAt: 10,
      presets: [],
      mergedTripIds: [],
    });
  });

  it('saves and removes through the shared list rules', () => {
    let book = savePresetInBook(createPresetBook('b1', 0), 'Desert noon', light(0.7), 'p1', 5);
    expect(book.presets.map((p) => p.name)).toEqual(['Desert noon']);
    expect(book.updatedAt).toBe(5);
    expect(savePresetInBook(book, 'Zeros', { ...DEFAULT_DEVELOP }, 'p2', 6)).toBe(book);
    book = removePresetFromBook(book, 'p1', 7);
    expect(book.presets).toEqual([]);
    expect(removePresetFromBook(book, 'p1', 8)).toBe(book);
  });

  it('reads a stored book safely: junk dropped, one preset per name', () => {
    const book = readPresetBook({
      id: 'b1',
      sourceId: 'winnow.example',
      updatedAt: 3,
      presets: [preset('p1', 'Dusk'), { id: 'x' }, preset('p2', ' dusk ', 1), preset('p3', 'Noon')],
      mergedTripIds: ['t1', 4],
    })!;
    expect(book.presets.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(book.mergedTripIds).toEqual(['t1']);
    expect(book.sourceId).toBe('winnow.example');
    expect(readPresetBook({ presets: [] })).toBeNull();
    expect(readPresetBook([])).toBeNull();
  });

  it('leaves without its source', () => {
    expect('sourceId' in bookToWire(createPresetBook('b1'))).toBe(false);
  });
});

describe('mergeTripPresets — once per trip', () => {
  it('brings a trip’s presets in, the book’s own numbers winning on a name', () => {
    const book = savePresetInBook(createPresetBook('b1', 0), 'Dusk', light(-1), 'mine', 1);
    const merged = mergeTripPresets(book, [
      { id: 't1', developPresets: [preset('a', 'dusk', 2), preset('b', 'Blue hour', 0.3)] },
    ], 9);
    expect(merged.presets.map((p) => [p.name, p.settings.exposure])).toEqual([
      ['Dusk', -1],
      ['Blue hour', 0.3],
    ]);
    expect(merged.mergedTripIds).toEqual(['t1']);
  });

  it('never brings back a preset deleted after its trip was merged', () => {
    let book = mergeTripPresets(createPresetBook('b1', 0), [{ id: 't1', developPresets: [preset('a', 'Dusk')] }], 1);
    book = removePresetFromBook(book, 'a', 2);
    expect(mergeTripPresets(book, [{ id: 't1', developPresets: [preset('a', 'Dusk')] }], 3)).toBe(book);
  });
});

describe('mergeBooks — two copies that both moved', () => {
  it('keeps the server’s order and row, the local copy of a name winning, local-only names appended', () => {
    const server = { ...createPresetBook('server-id', 1, 'winnow.example'), presets: [preset('s1', 'Dusk', 1), preset('s2', 'Noon', 2)], mergedTripIds: ['t1'] };
    const local = { ...createPresetBook('local-id', 1, 'winnow.example'), presets: [preset('l1', 'noon', 5), preset('l2', 'Night', 3)], mergedTripIds: ['t2'] };
    const merged = mergeBooks(local, server, 9);
    expect(merged.id).toBe('server-id');
    expect(merged.presets.map((p) => [p.name, p.settings.exposure])).toEqual([
      ['Dusk', 1],
      ['noon', 5],
      ['Night', 3],
    ]);
    expect(merged.mergedTripIds.sort()).toEqual(['t1', 't2']);
  });
});

describe('the identity on the book', () => {
  it('is read, written once, and survives a merge — the edited copy winning', () => {
    const book = createPresetBook('b', 1);
    expect(readPresetBook({ ...book })!.identity).toBeUndefined();
    const signed = withIdentity(book, { creator: ' Steeve Pommier ', copyright: '' }, 2);
    expect(signed.identity).toEqual({ creator: 'Steeve Pommier', copyright: '© {year} {creator}. All rights reserved.' });
    expect(signed.updatedAt).toBe(2);
    expect(withIdentity(signed, { creator: 'Steeve Pommier', copyright: '© {year} {creator}. All rights reserved.' })).toBe(signed);
    expect(readPresetBook(JSON.parse(JSON.stringify(signed)))!.identity).toEqual(signed.identity);

    const other = withIdentity(createPresetBook('s', 1), { creator: 'Other', copyright: 'x' }, 1);
    expect(mergeBooks(signed, other).identity?.creator).toBe('Steeve Pommier');
    expect(mergeBooks(book, other).identity?.creator).toBe('Other');
    expect(mergeBooks(book, createPresetBook('s', 1)).identity).toBeUndefined();
  });
});

describe('a preset that carries a look (item 6)', () => {
  const look = { layers: [{ id: 'classic-black-and-white', source: 'builtin', name: 'B&W', customText: null, intensity: 0.8, enabled: true }], output: 'none', film: null };
  it('is saved with its look, a look alone included, and read back from the book', () => {
    const book = createPresetBook('b', 1);
    const withLook = savePresetInBook(book, 'Mono', { ...DEFAULT_DEVELOP, exposure: 0.3 }, 'p1', 2, look as never);
    expect(withLook.presets[0].look).toEqual(look);
    const lookOnly = savePresetInBook(book, 'Just mono', null, 'p2', 2, look as never);
    expect(lookOnly.presets.map((p) => p.name)).toEqual(['Just mono']);
    expect(savePresetInBook(book, 'Nothing', null, 'p3', 2)).toBe(book);
    const back = readPresetBook(JSON.parse(JSON.stringify(withLook)))!;
    expect(back.presets[0].look?.layers[0]).toMatchObject({ id: 'classic-black-and-white', intensity: 0.8 });
    // A book written before looks existed reads with none.
    expect(readPresetBook({ ...book, presets: [{ id: 'x', name: 'Old', settings: { exposure: 1 } }] })!.presets[0].look).toBeUndefined();
  });
});
