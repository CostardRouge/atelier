/**
 * The vault, LIVE — one module-level list of the packs this browser holds,
 * read by every picker, and the one place a pack look's lattice is resolved.
 *
 * The shape is `develop/use-preset-book.ts`'s: module state, a subscriber set,
 * loaded once per tab the first time anyone asks. A pack is not a document a
 * tool opens and closes — it is a library the whole suite reads — so it lives
 * here rather than in one screen's state.
 *
 * Resolution is cached like the built-ins' (`restore-grade.ts`): the PROMISE,
 * not the result, so a deck whose five pictures all wear the same purchased
 * look decodes it once. A 65³ lattice is 1.57 MB and decodes in ~3 ms, but
 * five of them held at once would be 5 MB of floats for nothing.
 *
 * What is NOT here: fetching a look from a Winnow (that is step V5 of
 * `docs/lut-packs.md`, and this module is where it will plug in — one
 * `getStoredLattice` miss away).
 */

import type { CubeLut } from '../lib/cube-parser';
import {
  lookIn,
  lookLabel,
  type LutPackIndex,
  type PackLook,
  type PackRef,
} from './lut-pack';
import { decodeLattice } from './pack-codec';
import {
  deleteStoredPack,
  getStoredLattice,
  listStoredPacks,
  putStoredLattice,
  putStoredPack,
} from './pack-store';

let packs: LutPackIndex[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: LutPackIndex[]): void {
  packs = next;
  for (const fn of listeners) fn();
}

/** The packs as they stand — `[]` until the first load answers. */
export function packsSnapshot(): LutPackIndex[] {
  return packs;
}

export function subscribePacks(fn: () => void): () => void {
  listeners.add(fn);
  void loadPacks();
  return () => {
    listeners.delete(fn);
  };
}

/** Read the vault once per tab; later calls answer from memory. */
export async function loadPacks(): Promise<LutPackIndex[]> {
  if (loaded) return packs;
  loading ??= listStoredPacks().then((stored) => {
    loaded = true;
    loading = null;
    emit(stored);
  });
  await loading;
  return packs;
}

/** Tests, and the screen that empties the vault. */
export function resetPackState(): void {
  packs = [];
  loaded = false;
  loading = null;
  lattices.clear();
}

/** Add or replace a pack's index. */
export async function savePack(index: LutPackIndex): Promise<boolean> {
  const ok = await putStoredPack(index);
  emit([...packs.filter((p) => p.id !== index.id), index].sort((a, b) =>
    (a.name || a.author).localeCompare(b.name || b.author),
  ));
  return ok;
}

/** Forget a pack and its lattices. A grade that wore one of its looks then says so. */
export async function removePack(packId: string): Promise<void> {
  const pack = packs.find((p) => p.id === packId);
  await deleteStoredPack(packId);
  for (const look of pack?.looks ?? []) if (look.hash) lattices.delete(look.hash);
  emit(packs.filter((p) => p.id !== packId));
}

/** Store one look's encoded lattice — the import's write, per look. */
export async function saveLookLattice(
  packId: string,
  hash: string,
  bytes: Uint8Array,
): Promise<boolean> {
  return putStoredLattice(hash, packId, bytes);
}

/** Hide or show a node or a look in the pickers; the looks stay stored either way. */
export async function setPackHidden(packId: string, hidden: readonly string[]): Promise<void> {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;
  await savePack({ ...pack, hidden: [...hidden] });
}

/* ------------------------------------------------------------- resolution */

const lattices = new Map<string, Promise<CubeLut | null>>();

/** The pack a reference names, if this browser holds it. */
export function packOf(ref: PackRef): LutPackIndex | null {
  return packs.find((p) => p.id === ref.pack) ?? null;
}

/** The look a reference names, if this browser holds its pack. */
export function lookOf(ref: PackRef): PackLook | null {
  const pack = packOf(ref);
  return pack ? lookIn(pack, ref.look) : null;
}

/** How a pack look is named in a stack: pack · category · camera · look. */
export function packLookName(ref: PackRef): string | null {
  const pack = packOf(ref);
  const look = pack ? lookIn(pack, ref.look) : null;
  return pack && look ? lookLabel(pack, look) : null;
}

/**
 * The lattice a reference names, decoded — or null when this device does not
 * hold it. **Null is a state, not a failure**: the layer stays in the stack
 * and says so (`restore-grade.ts`), because a purchased look missing from one
 * device must be visible rather than silently neutral.
 *
 * The HASH is what is asked for, not the look's id: it is what the bytes are
 * keyed on, and it is what catches a pack whose author published a new
 * version of the same file.
 */
export function resolvePackLattice(ref: PackRef): Promise<CubeLut | null> {
  const hash = ref.hash || lookOf(ref)?.hash || '';
  if (!hash) return Promise.resolve(null);
  const known = lattices.get(hash);
  if (known) return known;
  const pending = getStoredLattice(hash).then((bytes) =>
    bytes ? decodeLattice(bytes, packLookName(ref) ?? undefined) : null,
  );
  // A miss is not remembered: the pack may be imported a moment later, and a
  // remembered null would keep the look missing for the rest of the session.
  pending
    .then((cube) => {
      if (!cube && lattices.get(hash) === pending) lattices.delete(hash);
    })
    .catch(() => lattices.delete(hash));
  lattices.set(hash, pending);
  return pending;
}

/** Why a look cannot grade here, in the words the panel shows. */
export function missingLookReason(ref: PackRef): string {
  return packOf(ref)
    ? 'This look is not in this browser’s vault yet.'
    : 'This look comes from a pack this browser does not hold.';
}
