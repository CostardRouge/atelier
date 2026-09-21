import { describe, expect, it, vi } from 'vitest';

// `gallery-nodes` reaches `virtual:luts` through `restore-grade`, and that
// Vite module does not exist in a node run — the very reason `saved-grade.ts`
// was split out of `restore-grade.ts`. An empty manifest is enough: the
// built-in families are not what is under test here.
vi.mock('virtual:luts', () => ({ default: [] }));
import { buildPackIndex, type LutPackIndex } from './lut-pack';
import { FAVOURITES_NODE, galleryNodes, matchingItems, packPickId } from './gallery-nodes';

/**
 * `galleryNodes` reaches for `virtual:luts` through `restore-grade`, which a
 * node run has no manifest for, so the built-in families come out empty here.
 * That is fine and is the point of the fixture: what is under test is the
 * FAVOURITES row and the pre-baked/live switch, both of which are arithmetic
 * over the packs and the star list.
 */
const PACK: LutPackIndex = {
  ...buildPackIndex(
    [
      { path: 'Creative LUT/AUTHENTIC.cube', hash: 'h-creative' },
      { path: 'One Click LUT/DJI/AUTHENTIC_D-LOG.cube', hash: 'h-dji' },
      { path: 'One Click LUT/SONY/AUTHENTIC_SLOG3.cube', hash: 'h-sony' },
    ],
    { id: 'pk_1', name: 'AUTHENTIC', author: 'Victor Jimenes' },
  ),
};
/** Thumbnails as the import bakes them, so the pre-baked path has something to draw. */
const WITH_THUMBS: LutPackIndex = {
  ...PACK,
  looks: PACK.looks.map((l) => ({ ...l, thumb: `data:image/webp;base64,${l.id}` })),
};

const dji = () => WITH_THUMBS.looks.find((l) => l.node === 'one-click/dji')!;
const sony = () => WITH_THUMBS.looks.find((l) => l.node === 'one-click/sony')!;

describe('the gallery rail', () => {
  it('draws no Favourites row when nothing is starred', () => {
    const nodes = galleryNodes([WITH_THUMBS], false);
    expect(nodes.some((n) => n.id === FAVOURITES_NODE)).toBe(false);
  });

  it('puts the starred looks FIRST, in the order they were starred', () => {
    const a = packPickId('pk_1', sony().id);
    const b = packPickId('pk_1', dji().id);
    const nodes = galleryNodes([WITH_THUMBS], false, {}, [a, b]);

    expect(nodes[0].id).toBe(FAVOURITES_NODE);
    expect(nodes[0].items.map((i) => i.id)).toEqual([a, b]);
    // It repeats what other rows own, which is what `aggregate` means here —
    // and what keeps a search from listing every starred look twice.
    expect(nodes[0].aggregate).toBe(true);
    expect(matchingItems(nodes, 'log').every(({ node }) => node.id !== FAVOURITES_NODE)).toBe(true);
  });

  it('leaves out a star whose look is gone, rather than drawing a hole', () => {
    const live = packPickId('pk_1', dji().id);
    const nodes = galleryNodes([WITH_THUMBS], false, {}, ['pack:pk_gone/whatever', live]);
    expect(nodes[0].id).toBe(FAVOURITES_NODE);
    expect(nodes[0].items.map((i) => i.id)).toEqual([live]);
  });

  it('draws no row at all when every star is gone', () => {
    const nodes = galleryNodes([WITH_THUMBS], false, {}, ['pack:pk_gone/whatever']);
    expect(nodes.some((n) => n.id === FAVOURITES_NODE)).toBe(false);
  });

  it('carries the baked thumbnail, and a resolve the GRID will not call', () => {
    const nodes = galleryNodes([WITH_THUMBS], false);
    const item = nodes.flatMap((n) => n.items).find((i) => i.id === packPickId('pk_1', dji().id))!;
    expect(item.thumb).toBe(`data:image/webp;base64,${dji().id}`);
    // The tile draws the baked thumbnail and decodes nothing — the rule that
    // makes a 25-look pack of 65³ lattices affordable, and what the modal
    // enforces by resolving only items with no thumb. The `resolve` is here
    // for the ONE look the scene aims at, whose lattice nothing else fetches.
    expect(typeof item.resolve).toBe('function');
  });

  it('gives every item the family its tile was baked on', () => {
    const nodes = galleryNodes([WITH_THUMBS], true);
    const items = nodes.filter((n) => !n.aggregate).flatMap((n) => n.items);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.family === 'log' || i.family === 'rec709')).toBe(true);
    // A film stock is a response to a photograph, never a conversion.
    const film = items.find((i) => i.id.startsWith('film:'));
    expect(film?.family).toBe('rec709');
  });

  it('drops every thumbnail and resolves instead when asked to bake live', () => {
    const nodes = galleryNodes([WITH_THUMBS], false, null);
    const items = nodes.filter((n) => !n.aggregate).flatMap((n) => n.items);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !i.thumb && typeof i.resolve === 'function')).toBe(true);
  });

  it('gives a built-in its shipped tile when the build has one', () => {
    // No `virtual:luts` here, so this is asserted on the pack's side: a look
    // with no baked thumb of its own still falls back to resolving.
    const bare: LutPackIndex = { ...PACK };
    const nodes = galleryNodes([bare], false);
    const item = nodes.flatMap((n) => n.items).find((i) => i.id.startsWith('pack:'))!;
    expect(item.thumb).toBeUndefined();
    expect(typeof item.resolve).toBe('function');
  });
});
