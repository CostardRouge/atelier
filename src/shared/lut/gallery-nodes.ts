/**
 * What the look gallery's rail lists, and what each of its nodes holds.
 *
 * The picker is a TREE and a grid (variant B of `docs/lut-packs.md` §6, the
 * maintainer's choice): one family at a time on the right, every family on
 * the left with its count. That shape is not only a layout — it is what keeps
 * a purchased pack affordable, since the grid never asks for more than one
 * node's looks, and a 25-look pack of 65³ lattices cannot all be resolved to
 * draw a screen.
 *
 * DOM-free: the built-in manifest, the film stocks and the packs in, a flat
 * list of nodes and their items out. What an item's picture COSTS is the
 * caller's problem — and since `docs/lut-packs.md` §7 the answer is normally
 * "nothing": a pack look carries a thumbnail baked at import, a built-in one
 * baked at `scripts/gen-lut-thumbs.mjs` time. Only the explicit "on my
 * picture" mode resolves a lattice.
 */

import { filmCubeFor } from '../film/film-layer';
import { FILM_GROUP_LABEL, FILM_STOCKS, filmSettingsFor } from '../film/stocks';
import type { CubeLut } from '../lib/cube-parser';
import { LUT_GROUPS, UNGROUPED_LUTS } from './builtin-luts';
import { flattenNodes, looksUnder, visibleLooks, type LutPackIndex, type PackLook } from './lut-pack';
import { missingLookReason, resolvePackLattice } from './pack-vault';
import { loadBuiltinLut } from './restore-grade';

/** How a picked look is named back to the host. */
export const FILM_PICK = 'film:';
export const PACK_PICK = 'pack:';

/** One tile. */
export interface GalleryItem {
  /** `<builtin id>`, `film:<stock>`, or `pack:<packId>/<lookId>`. */
  id: string;
  name: string;
  /**
   * A tile that already exists: a pack look's, baked at import, or a
   * built-in's, baked by `scripts/gen-lut-thumbs.mjs` and shipped. Either way
   * the item draws without resolving a lattice, which is the whole point.
   */
  thumb?: string;
  /** The cube, fetched or generated — used when there is no tile, and for the live bake. */
  resolve?: () => Promise<CubeLut>;
}

/** One row of the rail. */
export interface GalleryNode {
  id: string;
  label: string;
  /** 0 for a family, 1 for a category, 2 for a camera. */
  depth: number;
  /** A caution the node carries — the pack's own ("D-Log, not D-Log M"). */
  hint?: string;
  /** Set on a pack's root node: the credits belong to it. */
  pack?: LutPackIndex;
  /** True when the node holds no look of its own and shows its branch's instead. */
  aggregate?: boolean;
  items: GalleryItem[];
}

const BUILTIN_ROOT = 'builtin';
const FILM_NODE = 'film';
/** The starred shortlist's own row — `use-lut-favourites.ts` holds the list. */
export const FAVOURITES_NODE = 'favourites';

/** A pack look's pick id — what `GradePanel` turns back into a reference. */
export function packPickId(packId: string, lookId: string): string {
  return `${PACK_PICK}${packId}/${lookId}`;
}

/** The pack and look a pick id names, or null. */
export function readPackPick(id: string): { pack: string; look: string } | null {
  if (!id.startsWith(PACK_PICK)) return null;
  const rest = id.slice(PACK_PICK.length);
  const cut = rest.indexOf('/');
  if (cut <= 0) return null;
  return { pack: rest.slice(0, cut), look: rest.slice(cut + 1) };
}

/**
 * Every node, in rail order: the built-ins and their folders, the film stocks
 * where the host offers them, then one branch per pack.
 *
 * `thumbs` is the pre-baked tiles a build ships (`builtin-thumbs.ts`), keyed
 * by item id. **`null` means bake LIVE**: nothing carries a `thumb`, so every
 * item — a pack's looks included — resolves its lattice and is baked on the
 * caller's own picture. That is the "on my picture" mode, and since
 * `docs/lut-packs.md` §7 it is an explicit choice rather than the default,
 * because the default costs nothing at all.
 */
export function galleryNodes(
  packs: readonly LutPackIndex[],
  includeFilm: boolean,
  thumbs: Readonly<Record<string, string>> | null = {},
  favourites: readonly string[] = [],
): GalleryNode[] {
  const nodes: GalleryNode[] = [];
  /** A tile a build already baked, if this is not the live mode. */
  const baked = (id: string): { thumb?: string } => {
    const url = thumbs?.[id];
    return url ? { thumb: url } : {};
  };

  const builtinItems = (list: typeof UNGROUPED_LUTS): GalleryItem[] =>
    list.map((l) => ({
      id: l.id,
      name: l.name,
      ...baked(l.id),
      resolve: () => loadBuiltinLut(l.id).then((r) => r.lut),
    }));

  if (includeFilm) {
    nodes.push({
      id: FILM_NODE,
      label: FILM_GROUP_LABEL,
      depth: 0,
      items: FILM_STOCKS.map((s) => ({
        id: `${FILM_PICK}${s.id}`,
        name: s.name,
        ...baked(`${FILM_PICK}${s.id}`),
        resolve: () => Promise.resolve(filmCubeFor(filmSettingsFor(s.id))),
      })),
    });
  }

  nodes.push({
    id: BUILTIN_ROOT,
    label: 'Built-in',
    depth: 0,
    // The root node holds the looks that sit at `luts/`'s own level; its
    // folders are the rows under it.
    items: builtinItems(UNGROUPED_LUTS),
  });
  for (const group of LUT_GROUPS) {
    nodes.push({
      id: `builtin/${group.label}`,
      label: group.label,
      depth: 1,
      items: builtinItems(group.luts),
    });
  }

  for (const pack of packs) {
    const rootLooks = visibleLooks(pack).filter((l) => !l.node);
    nodes.push({
      id: `pack/${pack.id}`,
      label: pack.name || pack.author || 'Pack',
      depth: 0,
      pack,
      items: rootLooks.map((l) => packItem(pack, l, thumbs !== null)),
    });
    for (const { node, depth } of flattenNodes(pack.tree)) {
      const branch = looksUnder(pack, node.id);
      if (!branch.length) continue;
      // A category whose looks all hang from its cameras shows its WHOLE
      // branch: it is where you land before picking a camera, and an empty
      // grid there would read as a category that holds nothing.
      const direct = branch.filter((l) => l.node === node.id);
      nodes.push({
        id: `pack/${pack.id}/${node.id}`,
        label: node.label,
        depth: depth + 1,
        ...(node.hint ? { hint: node.hint } : {}),
        items: (direct.length ? direct : branch).map((l) => packItem(pack, l, thumbs !== null)),
      });
    }
  }

  // ★ Favourites, first in the rail (§6). It repeats items the other nodes
  // own — which is exactly what `aggregate` already means here, and what
  // keeps a search from listing every starred look twice. A star whose look
  // is gone (a pack forgotten, a `.cube` dropped from the build) is left out
  // silently: the list keeps it, so re-importing the pack brings it back.
  if (favourites.length) {
    const byId = new Map(nodes.flatMap((n) => n.items).map((item) => [item.id, item]));
    const items = favourites.map((id) => byId.get(id)).filter((i): i is GalleryItem => !!i);
    if (items.length) {
      nodes.unshift({ id: FAVOURITES_NODE, label: '★ Favourites', depth: 0, aggregate: true, items });
    }
  }

  // A node whose looks all hang from its children shows the WHOLE branch:
  // `Built-in` holds nothing at `luts/`'s own level, and a pack's root holds
  // nothing when every look is filed under a category. A row that counted 0
  // and opened on an empty grid would read as a family that holds nothing.
  return nodes.map((node) =>
    node.items.length
      ? node
      : {
          ...node,
          aggregate: true,
          items: nodes
            .filter((n) => n.id.startsWith(`${node.id}/`))
            .flatMap((n) => n.items)
            .filter((item, i, all) => all.findIndex((x) => x.id === item.id) === i),
        },
  );
}

/**
 * One pack look as a tile. Normally it draws the thumbnail baked at import,
 * on the reference its family asked for, and resolves nothing — which is what
 * lets a 25-look pack of 65³ lattices be drawn at all. Asked to bake LIVE it
 * resolves like everything else; the rail bounds that to one node, and a look
 * whose bytes this device does not hold says "failed" rather than quietly
 * drawing the import's tile over someone else's picture.
 */
function packItem(pack: LutPackIndex, look: PackLook, usePreBaked: boolean): GalleryItem {
  const id = packPickId(pack.id, look.id);
  if (usePreBaked && look.thumb) return { id, name: look.label, thumb: look.thumb };
  return {
    id,
    name: look.label,
    resolve: async () => {
      const lut = await resolvePackLattice({ pack: pack.id, look: look.id, hash: look.hash ?? '' });
      if (!lut) throw new Error(missingLookReason({ pack: pack.id, look: look.id, hash: '' }));
      return lut;
    },
  };
}

/** Every item of every node, for a search that ignores the rail. */
export function matchingItems(
  nodes: readonly GalleryNode[],
  query: string,
): { node: GalleryNode; items: GalleryItem[] }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    // An aggregating node repeats its branch's looks, which would show every
    // match twice: a search reads the nodes that OWN their looks.
    .filter((node) => !node.aggregate)
    .map((node) => ({ node, items: node.items.filter((i) => i.name.toLowerCase().includes(q)) }))
    .filter(({ items }) => items.length > 0);
}
