import { afterEach, describe, expect, it, vi } from 'vitest';

// `restore-grade` reads the built-in list from `virtual:luts`, a Vite module
// that does not exist in a node run. One entry is enough: `dlog` is a look
// this build ships, and any other id is one it no longer does.
vi.mock('virtual:luts', () => ({
  default: [{ id: 'dlog', name: 'D-Log to Rec.709', group: '', file: 'dlog.cube' }],
}));
import { newFilmLayer } from '../film/film-layer';
import { activeLayers } from './lut-stack';
import { restoreLayers } from './restore-grade';
import { savedLayers } from './saved-grade';
import type { SavedLutLayer } from './use-lut-stack';

/** A 2³ identity `.cube`, as a fetched built-in's text. */
const CUBE_TEXT = [
  'LUT_3D_SIZE 2',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\n');

const film = newFilmLayer('l-film', 'reversal-vivid');
/** A grade as a roll stores it: a look this build dropped, between two that resolve. */
const STORED: SavedLutLayer[] = [
  { id: 'l-gone', source: 'builtin:renamed-look', name: 'Renamed look', customText: null, intensity: 0.8, enabled: true },
  ...savedLayers([film.layer], { [film.layer.id]: film.text }),
  { id: 'l-bad', source: 'custom', name: 'Old upload.cube', customText: 'not a cube', intensity: 1, enabled: false },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('restoring a stored grade', () => {
  it('keeps a built-in this build no longer ships, in its place, marked missing', async () => {
    const { layers } = await restoreLayers(STORED);

    expect(layers.map((l) => l.id)).toEqual(['l-gone', 'l-film', 'l-bad']);
    const gone = layers[0];
    expect(gone.name).toBe('Renamed look');
    expect(gone.missing).toBe('That look is no longer available.');
    // An identity cube, so every reader stays total — and the bake skips it,
    // so it never grades as a silent identity either.
    expect(gone.lut.size).toBe(2);
    expect(activeLayers(layers).map((l) => l.id)).toEqual(['l-film']);
    // The film stock beside it resolved as ever.
    expect(layers[1].missing).toBeUndefined();
  });

  it('keeps an uploaded cube whose text does not parse, with its text', async () => {
    const { layers, customText } = await restoreLayers(STORED);
    expect(layers[2].missing).toBe('This uploaded look could not be read.');
    expect(customText['l-bad']).toBe('not a cube');
  });

  it('round-trips: the saved form of what was restored IS what was stored', async () => {
    // The whole bug: a host writes its stack back whenever this differs from
    // what it restored, so a dropped layer made an OPEN rewrite the document.
    const { layers, customText } = await restoreLayers(STORED);
    expect(savedLayers(layers, customText)).toEqual(STORED);
  });

  it('keeps a built-in it could not FETCH, with a reason that says so, and round-trips', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const stored: SavedLutLayer[] = [
      { id: 'l-dlog', source: 'builtin:dlog', name: 'D-Log to Rec.709', customText: null, intensity: 1, enabled: true },
    ];
    const { layers, customText } = await restoreLayers(stored);
    expect(layers).toHaveLength(1);
    expect(layers[0].missing).toMatch(/^Could not fetch D-Log to Rec\.709/);
    expect(savedLayers(layers, customText)).toEqual(stored);
  });

  it('resolves a built-in it ships, with nothing missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(CUBE_TEXT) }),
    );
    const stored: SavedLutLayer[] = [
      { id: 'l-dlog', source: 'builtin:dlog', name: 'D-Log to Rec.709', customText: null, intensity: 1, enabled: true },
    ];
    const { layers, customText } = await restoreLayers(stored);
    expect(layers[0].missing).toBeUndefined();
    expect(layers[0].lut.size).toBe(2);
    expect(savedLayers(layers, customText)).toEqual(stored);
  });
});
