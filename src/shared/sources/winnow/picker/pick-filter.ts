/**
 * What the Winnow picker SHOWS and what its verbs TICK — the pure half of
 * `WinnowPicker` (`docs/winnow-day-sheet-verdicts.md` §7).
 *
 * The picker lists a day or a folder of an instance and lets a person tick
 * what to take: into the Library (*browse all*) or onto a Develop roll (*Add
 * a day*). Everything it decides about the rows is here, DOM-free:
 *
 * - **A row's culling** is Winnow's (`culling.ts`), read and never written,
 *   and sorted into five BUCKETS: picks, starred without a flag, unrated,
 *   skipped, rejected. A star on a pick is still a pick: the flag is the
 *   stronger statement.
 * - **The facets** — buckets, stars at least, type, extension, device, tags,
 *   no final yet, not already held — are multi-select and filtered HERE over
 *   the scope's rows. Only the library half goes to the server (it is a
 *   scope, and a capped list filtered afterwards loses rows). Their counts
 *   are the SCOPE's, so ticking one facet never moves another's numbers.
 * - **A burst pile** shows its cover and every frame Winnow said yes to (a
 *   pick, or a star): the frame elected inside a pile is the one a person
 *   came for, and it is never the cover. The rest unfold on request.
 * - **The verbs act on what is SHOWN**: filter by a body, press `4`, and the
 *   ★4+ of that body are ticked. A ticked picture a filter hides stays ticked
 *   and is COUNTED, never added in silence.
 */

import type { WinnowAssetRow } from '../client';
import { cullingFromRow, type Culling } from '../culling';

// --- one row, read once ------------------------------------------------------

/** Where Winnow's word puts a row. */
export type Bucket = 'pick' | 'star' | 'unrated' | 'skip' | 'reject';
export const BUCKETS: readonly Bucket[] = ['pick', 'star', 'unrated', 'skip', 'reject'];

export const BUCKET_LABEL: Record<Bucket, string> = {
  pick: 'Picks',
  star: 'Starred, no flag',
  unrated: 'Unrated',
  skip: 'Skipped',
  reject: 'Rejected',
};

/** A row that says nothing of its culling (an older instance) reads as unrated. */
export function bucketOf(c: Culling | null): Bucket {
  if (!c) return 'unrated';
  if (c.verdict === 'pick') return 'pick';
  if (c.verdict === 'reject') return 'reject';
  if (c.verdict === 'skip') return 'skip';
  return c.star > 0 ? 'star' : 'unrated';
}

export type MediaKind = 'photo' | 'video';

export interface PickItem {
  row: WinnowAssetRow;
  id: number;
  culling: Culling | null;
  bucket: Bucket;
  star: number;
  kind: MediaKind;
  /** Lowercase, no dot — as Winnow stores it. */
  ext: string;
  /** The other half of a RAW+JPEG pair, lowercase; null otherwise. */
  pairExt: string | null;
  device: string | null;
  tags: readonly string[];
  /** A Gallery final already links to it, or it IS a linked final. */
  hasFinal: boolean;
  /** The pile it belongs to, when Winnow stacked it. */
  pileId: number | null;
  /** Already where the host would put it — on the roll, in the Library. */
  held: boolean;
}

export function pickItem(row: WinnowAssetRow, held: boolean): PickItem {
  const culling = cullingFromRow(row);
  const companion = row.group_kind === 'raw_jpeg' ? row.companion_ext?.toLowerCase() || null : null;
  return {
    row,
    id: row.id,
    culling,
    bucket: bucketOf(culling),
    star: culling?.star ?? 0,
    kind: row.media_type === 'video' ? 'video' : 'photo',
    ext: (row.ext ?? '').toLowerCase().replace(/^\./, ''),
    pairExt: companion ? companion.replace(/^\./, '') : null,
    device: row.device?.trim() || row.camera_model?.trim() || null,
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string' && t !== '') : [],
    hasFinal: (row.edit_count ?? 0) > 0 || row.original_asset_id != null,
    pileId: typeof row.burst_id === 'number' && (row.burst_count ?? 2) > 1 ? row.burst_id : null,
    held,
  };
}

// --- piles ------------------------------------------------------------------

export interface Pile {
  id: number;
  /** The frame drawn for the pile: the stored cover when listed, else its first listed frame. */
  coverId: number;
  /** Every frame of the pile the list holds, in list order. */
  frameIds: number[];
  /** The pile's live size, as Winnow counts it — more than `frameIds` when only the cover was listed. */
  size: number;
}

export function pilesOf(items: readonly PickItem[]): Map<number, Pile> {
  const out = new Map<number, Pile>();
  for (const it of items) {
    if (it.pileId === null) continue;
    const pile = out.get(it.pileId);
    if (pile) pile.frameIds.push(it.id);
    else out.set(it.pileId, { id: it.pileId, coverId: it.id, frameIds: [it.id], size: it.row.burst_count ?? 1 });
  }
  for (const pile of out.values()) {
    const stored = items.find((it) => it.pileId === pile.id)?.row.burst_cover_id;
    if (stored != null && pile.frameIds.includes(stored)) pile.coverId = stored;
    pile.size = Math.max(pile.size, pile.frameIds.length);
  }
  return out;
}

/** Whether Winnow said yes to a frame — the frames a folded pile still shows. */
const saidYes = (it: PickItem) => it.bucket === 'pick' || it.star > 0;

/**
 * What the grid can draw: a pile folded to its cover and the frames Winnow
 * said yes to, or unfolded whole. Rows outside a pile pass untouched. A frame
 * of an UNFOLDED pile is left out here: the grid draws it in its pile's row,
 * under the cover, so the same picture is never drawn twice.
 */
export function surfaced(
  items: readonly PickItem[],
  piles: ReadonlyMap<number, Pile>,
  unfolded: ReadonlySet<number>,
): PickItem[] {
  return items.filter((it) => {
    if (it.pileId === null) return true;
    const pile = piles.get(it.pileId);
    if (!pile || pile.coverId === it.id) return true;
    if (unfolded.has(it.pileId)) return false;
    return saidYes(it);
  });
}

/** The frames an unfolded pile draws under its cover, the cover left out. */
export function framesUnder(items: readonly PickItem[], pile: Pile): PickItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  return pile.frameIds.filter((id) => id !== pile.coverId).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

// --- facets -----------------------------------------------------------------

export interface PickFacets {
  /** The buckets shown; rejects are left out until asked for. */
  buckets: Bucket[];
  /** 0 is no floor. */
  minStar: number;
  kinds: MediaKind[];
  exts: string[];
  devices: string[];
  tags: string[];
  /** Only what no Gallery final links to yet. */
  noFinal: boolean;
  /** Only what the host does not hold yet. */
  notHeld: boolean;
}

export const DEFAULT_FACETS: PickFacets = {
  buckets: ['pick', 'star', 'unrated', 'skip'],
  minStar: 0,
  kinds: [],
  exts: [],
  devices: [],
  tags: [],
  noFinal: false,
  notHeld: false,
};

/** Every bucket shown, nothing else narrowed — what "show the hidden ones" restores. */
export const SHOW_ALL: PickFacets = { ...DEFAULT_FACETS, buckets: [...BUCKETS] };

export function passes(it: PickItem, f: PickFacets): boolean {
  if (!f.buckets.includes(it.bucket)) return false;
  if (f.minStar > 0 && it.star < f.minStar) return false;
  if (f.kinds.length && !f.kinds.includes(it.kind)) return false;
  if (f.exts.length && !f.exts.includes(it.ext)) return false;
  if (f.devices.length && (it.device === null || !f.devices.includes(it.device))) return false;
  if (f.tags.length && !it.tags.some((t) => f.tags.includes(t))) return false;
  if (f.noFinal && it.hasFinal) return false;
  if (f.notHeld && it.held) return false;
  return true;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v) => b.includes(v));

/** How many facets narrow the list beyond the default — the number on the phone's Filters button. */
export function activeFacets(f: PickFacets): number {
  return (
    (sameSet(f.buckets, DEFAULT_FACETS.buckets) ? 0 : 1) +
    (f.minStar > 0 ? 1 : 0) +
    f.kinds.length +
    f.exts.length +
    f.devices.length +
    f.tags.length +
    (f.noFinal ? 1 : 0) +
    (f.notHeld ? 1 : 0)
  );
}

/** Toggle one value of a list facet. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** A stored value read back; anything that is not the shape we write is the default. */
export function readFacets(raw: unknown): PickFacets {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_FACETS;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 120).slice(0, 40) : [];
  const buckets = strings(r.buckets).filter((b): b is Bucket => (BUCKETS as readonly string[]).includes(b));
  const minStar = typeof r.minStar === 'number' && Number.isInteger(r.minStar) ? Math.max(0, Math.min(5, r.minStar)) : 0;
  return {
    // An empty list would show nothing at all; it reads as the default instead.
    buckets: buckets.length ? buckets : DEFAULT_FACETS.buckets,
    minStar,
    kinds: strings(r.kinds).filter((k): k is MediaKind => k === 'photo' || k === 'video'),
    exts: strings(r.exts),
    devices: strings(r.devices),
    tags: strings(r.tags),
    noFinal: r.noFinal === true,
    notHeld: r.notHeld === true,
  };
}

// --- counts -----------------------------------------------------------------

export interface FacetCounts {
  total: number;
  buckets: Record<Bucket, number>;
  /** `starsAtLeast[k]` — rows with k stars or more, k from 1 to 5; index 0 is the total. */
  starsAtLeast: number[];
  kinds: Map<MediaKind, number>;
  /** By extension, with the pair's other half when the files are paired. */
  exts: Map<string, { count: number; pair: string | null }>;
  devices: Map<string, number>;
  tags: Map<string, number>;
  noFinal: number;
  notHeld: number;
}

/** The scope's numbers, over what the grid could draw (`surfaced`), filters ignored. */
export function facetCounts(items: readonly PickItem[]): FacetCounts {
  const out: FacetCounts = {
    total: items.length,
    buckets: { pick: 0, star: 0, unrated: 0, skip: 0, reject: 0 },
    starsAtLeast: [items.length, 0, 0, 0, 0, 0],
    kinds: new Map(),
    exts: new Map(),
    devices: new Map(),
    tags: new Map(),
    noFinal: 0,
    notHeld: 0,
  };
  for (const it of items) {
    out.buckets[it.bucket] += 1;
    for (let k = 1; k <= Math.min(5, it.star); k++) out.starsAtLeast[k] += 1;
    out.kinds.set(it.kind, (out.kinds.get(it.kind) ?? 0) + 1);
    const ext = out.exts.get(it.ext);
    if (ext) {
      ext.count += 1;
      ext.pair ??= it.pairExt;
    } else out.exts.set(it.ext, { count: 1, pair: it.pairExt });
    if (it.device) out.devices.set(it.device, (out.devices.get(it.device) ?? 0) + 1);
    for (const t of it.tags) out.tags.set(t, (out.tags.get(t) ?? 0) + 1);
    if (!it.hasFinal) out.noFinal += 1;
    if (!it.held) out.notHeld += 1;
  }
  return out;
}

/**
 * A facet's values in the order the rail lists them: by count, then by name —
 * plus any value still ticked that the scope no longer holds, at zero, so a
 * filter carried over from another day can be seen and unticked.
 */
export function facetValues(counts: ReadonlyMap<string, number>, ticked: readonly string[]): [string, number][] {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const t of ticked) if (!counts.has(t)) rows.push([t, 0]);
  return rows;
}

// --- the list the grid draws -------------------------------------------------

export type PickSort = 'time' | 'stars';

/**
 * What the grid draws, in its order: the surfaced rows that pass the facets.
 * `time` is the order the instance listed them in (capture time, oldest
 * first); `stars` puts the most starred first and keeps that order within.
 */
export function shown(surfacedItems: readonly PickItem[], f: PickFacets, sort: PickSort): PickItem[] {
  const out = surfacedItems.filter((it) => passes(it, f));
  if (sort === 'stars') {
    const order = new Map(out.map((it, i) => [it.id, i]));
    out.sort((a, b) => b.star - a.star || order.get(a.id)! - order.get(b.id)!);
  }
  return out;
}

/**
 * Everything the grid DRAWS, in its order: each shown row, followed by the
 * frames of its pile when that pile is unfolded under it. This — not
 * `shown` — is what the verbs act on and what "hidden" is counted against:
 * a frame drawn in an unfolded pile is on screen, facets or not.
 */
export function drawn(
  shownItems: readonly PickItem[],
  items: readonly PickItem[],
  piles: ReadonlyMap<number, Pile>,
  unfolded: ReadonlySet<number>,
): PickItem[] {
  const out: PickItem[] = [];
  for (const it of shownItems) {
    out.push(it);
    const pile = it.pileId === null ? undefined : piles.get(it.pileId);
    if (pile && pile.coverId === it.id && unfolded.has(pile.id)) out.push(...framesUnder(items, pile));
  }
  return out;
}

// --- ticking -----------------------------------------------------------------

export type TickVerb = 'picks' | 'stars5' | 'stars4' | 'stars3';

export const TICK_VERB_LABEL: Record<TickVerb, string> = {
  picks: 'Picks',
  stars5: '★5',
  stars4: '★4+',
  stars3: '★3+',
};

/** The ids a verb ticks among what is drawn (`drawn`), held rows left out. */
export function idsFor(verb: TickVerb, shownItems: readonly PickItem[]): number[] {
  const floor = verb === 'stars5' ? 5 : verb === 'stars4' ? 4 : verb === 'stars3' ? 3 : 0;
  return shownItems
    .filter((it) => !it.held && (verb === 'picks' ? it.bucket === 'pick' : it.star >= floor))
    .map((it) => it.id);
}

/** What is ticked when the picker opens on a scope. */
export type OpeningTicks = 'picks' | 'none' | 'all';

/**
 * `picks` ticks the picks of a CULLED scope and falls back to everything not
 * held where Winnow has picked nothing yet — today's rule for an unculled day.
 * Rejects are never ticked by `all`: nobody opens a day to add what they
 * threw away.
 */
export function openingTicks(rule: OpeningTicks, items: readonly PickItem[]): Set<number> {
  const free = items.filter((it) => !it.held);
  if (rule === 'none') return new Set();
  if (rule === 'picks') {
    const picks = free.filter((it) => it.bucket === 'pick');
    if (picks.length) return new Set(picks.map((it) => it.id));
  }
  return new Set(free.filter((it) => it.bucket !== 'reject').map((it) => it.id));
}

export function withAll(ticked: ReadonlySet<number>, shownItems: readonly PickItem[]): Set<number> {
  const next = new Set(ticked);
  for (const it of shownItems) if (!it.held) next.add(it.id);
  return next;
}

export function withNoneShown(ticked: ReadonlySet<number>, shownItems: readonly PickItem[]): Set<number> {
  const next = new Set(ticked);
  for (const it of shownItems) next.delete(it.id);
  return next;
}

export function inverted(ticked: ReadonlySet<number>, shownItems: readonly PickItem[]): Set<number> {
  const next = new Set(ticked);
  for (const it of shownItems) {
    if (it.held) continue;
    if (next.has(it.id)) next.delete(it.id);
    else next.add(it.id);
  }
  return next;
}

/** A ⇧-click: every row between the anchor and this one takes this one's new state. */
export function rangeTicked(
  ticked: ReadonlySet<number>,
  shownItems: readonly PickItem[],
  anchorId: number,
  id: number,
): Set<number> {
  const a = shownItems.findIndex((it) => it.id === anchorId);
  const b = shownItems.findIndex((it) => it.id === id);
  const next = new Set(ticked);
  if (a < 0 || b < 0) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  const on = !ticked.has(id);
  for (const it of shownItems.slice(Math.min(a, b), Math.max(a, b) + 1)) {
    if (it.held) continue;
    if (on) next.add(it.id);
    else next.delete(it.id);
  }
  return next;
}

/** Ticked rows nothing draws (`drawn`) — counted on the bar, still added. */
export function hiddenTicked(ticked: ReadonlySet<number>, shownItems: readonly PickItem[]): number {
  const visible = new Set(shownItems.map((it) => it.id));
  let n = 0;
  for (const id of ticked) if (!visible.has(id)) n += 1;
  return n;
}
