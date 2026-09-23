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
 * A pack KEPT on a Winnow (`pack-remote.ts`) reaches this module in one
 * place: a `getStoredLattice` miss asks the instance, stores what comes back
 * and decodes it. That is the whole of "fetch on first use and cache" — a
 * phone that has never seen the pack grades with it the moment a picture asks,
 * and never again downloads it.
 */

import type { CubeLut } from '../lib/cube-parser';
import {
  lookIn,
  lookLabel,
  withoutLooks,
  type LutPackIndex,
  type PackLook,
  type PackRef,
} from './lut-pack';
import { decodeLattice } from './pack-codec';
import {
  deleteRemoteLooks,
  deleteRemotePack,
  fetchRemoteLattice,
  fetchRemotePacks,
  packHost,
  packHosts,
  pushPack,
  type PackHost,
  type PushPackResult,
  type PushProgress,
} from './pack-remote';
import {
  deleteStoredLattices,
  deleteStoredPack,
  getStoredLattice,
  listStoredPacks,
  putStoredLattice,
  putStoredPack,
  storedLatticeSizes,
} from './pack-store';
import {
  blobBytes,
  freedBlobs,
  freedHashes,
  hashBytes,
  type ForgetResult,
} from './pack-weight';

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

/**
 * Forget a whole pack: its index and its lattices, here and on the instance
 * it is kept on. A grade that wore one of its looks then says so
 * (`missingLookReason`) rather than grading flat.
 */
export function removePack(packId: string): Promise<ForgetResult> {
  return forget(packId, null);
}

/**
 * Forget ONE look — the maintainer's own case: a pack whose Sony and film
 * cameras he does not own, 1.6 MB apiece, hidden and still costing.
 *
 * Hiding is the other verb and stays (`setPackHidden`): it puts a look away
 * and keeps its bytes. This one is the reverse and is the only one of the two
 * a document can notice.
 */
export function forgetLook(packId: string, lookId: string): Promise<ForgetResult> {
  return forget(packId, [lookId]);
}

/**
 * `lookIds === null` means the whole pack.
 *
 * **A pack kept on an instance is forgotten THERE or not at all.** §4.2 of
 * the plan is explicit that the instance is the truth and this vault is its
 * cache, so a forget that could not reach it would not be a forget: the next
 * device to adopt the pack would bring the look straight back, and the bytes
 * there would never be reclaimed by anyone. So an unreachable instance
 * refuses the gesture and says which one, and nothing changes. A pack kept
 * only in this browser has no such question to answer.
 *
 * The remote side runs FIRST and the local write follows: a failure there
 * leaves both copies as they were, where the reverse order would leave this
 * browser holding a pack the instance still offers in full.
 */
async function forget(packId: string, lookIds: readonly string[] | null): Promise<ForgetResult> {
  await loadPacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) throw new Error('That pack is not in this browser.');
  const whole = lookIds === null;
  const doomed = whole ? pack.looks.map((l) => l.id) : lookIds;
  const keptOn = pack.sourceId ?? null;
  const host = keptOn ? packHost(keptOn) : null;
  if (keptOn && !host) {
    throw new Error(
      `This pack is kept on ${keptOn}. Connect it, so ${
        whole ? 'the pack' : 'the look'
      } is forgotten there too and its bytes come back.`,
    );
  }

  const sizes = await storedLatticeSizes();
  const here = freedHashes(packs, packId, doomed);
  const there = host ? freedBlobs(packs, packId, doomed, host.sourceId) : { free: [], shared: [] };
  const next = whole ? null : withoutLooks(pack, doomed);
  // Weighed BEFORE anything is written: both figures are read off the indexes
  // as they stand, and the write is about to take the very looks they are
  // read from out of them.
  const result: ForgetResult = {
    here: hashBytes(here.free, sizes),
    instance: host ? blobBytes(there.free, packs) : 0,
    keptOn,
    shared: here.shared.length,
  };

  if (host) {
    if (next) await deleteRemoteLooks(host, next, there.free);
    else await deleteRemotePack(host, pack, new Set(there.shared));
  }

  if (next) {
    await savePack(next);
  } else {
    await deleteStoredPack(packId);
    emit(packs.filter((p) => p.id !== packId));
  }
  await deleteStoredLattices(here.free);
  // The decode cache is keyed on the hash, so a look whose bytes are gone
  // must lose its promise or the rest of the session keeps grading with it.
  for (const hash of here.free) lattices.delete(hash);

  return result;
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
  const pending = getStoredLattice(hash)
    .then((bytes) => bytes ?? fetchAndKeep(ref, hash))
    .then((bytes) => (bytes ? decodeLattice(bytes, packLookName(ref) ?? undefined) : null));
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

/**
 * The vault does not hold it: ask the instance the pack is kept on, and keep
 * what comes back. A pack that is local-only, an instance that is not
 * connected, or a network that is down all answer null — which the caller
 * reads as "not in this browser's vault", the honest state.
 */
async function fetchAndKeep(ref: PackRef, hash: string): Promise<Uint8Array | null> {
  const pack = packOf(ref);
  const host = pack?.sourceId ? packHost(pack.sourceId) : null;
  // The instance knows the bytes by their OWN hash (`PackLook.blob`), not by
  // the `.cube`'s. It is written into the index by the push, so a look whose
  // blob is blank is one this pack has never had pushed — nothing to ask for,
  // and asking under the wrong id would 404 on every picture.
  const blob = pack?.looks.find((l) => l.hash === hash)?.blob;
  if (!pack || !host || !blob) return null;
  try {
    const bytes = await fetchRemoteLattice(host, blob);
    if (!bytes) return null;
    // Cached on the way through: the phone downloads a look once, then
    // grades with it offline (`docs/lut-packs.md` §4.2 — the cache is a
    // cache, the instance is the truth).
    await saveLookLattice(pack.id, hash, bytes);
    return bytes;
  } catch {
    // Offline, signed out, or refused: the look is simply not here yet.
    return null;
  }
}

/* --------------------------------------------------------------- keeping */

/** The instances that can keep a pack — connected, with both buckets. */
export function packKeepers(): PackHost[] {
  return packHosts();
}

/**
 * Keep a pack on an instance: push its lattices, then its index, then record
 * WHERE it is kept so another device — and this one, after a cache eviction —
 * knows who to ask. The author's gesture, never automatic.
 */
export async function keepPackOn(
  packId: string,
  sourceId: string,
  onProgress?: (progress: PushProgress) => void,
): Promise<PushPackResult> {
  const pack = packs.find((p) => p.id === packId);
  const host = packHost(sourceId);
  if (!pack) throw new Error('That pack is not in this browser.');
  if (!host) throw new Error('That instance cannot keep a pack — reconnect it and try again.');
  const result = await pushPack({ ...host }, pack, (hash) => getStoredLattice(hash), onProgress);
  // The index the push WROTE, not the one it was given: it carries each look's
  // blob, which is what this device reads back to fetch a look it has evicted
  // and what the next push reads to know there is nothing to send.
  await savePack({ ...result.index, sourceId });
  return result;
}

/** The packs an instance holds that this browser does not. */
export async function remotePacksNotHere(host: PackHost): Promise<LutPackIndex[]> {
  const here = new Set(packs.map((p) => p.id));
  const there = await fetchRemotePacks(host);
  return there.filter((p) => !here.has(p.id));
}

/**
 * Take a remote pack into this browser: its INDEX only. The lattices follow
 * one at a time, as pictures ask for them — 40 MB on a phone is not something
 * to download because a list was opened.
 */
export async function adoptRemotePack(index: LutPackIndex, sourceId: string): Promise<void> {
  await savePack({ ...index, sourceId });
}

/** Why a look cannot grade here, in the words the panel shows. */
export function missingLookReason(ref: PackRef): string {
  const pack = packOf(ref);
  if (!pack) return 'This look comes from a pack this browser does not hold.';
  // The pack is here and this look is NOT in it: it was forgotten, or its
  // author republished the pack without it. The same STATE as any other
  // missing look — the layer stays, named and skipped by the bake — and a
  // different sentence, because "not here yet" would be a lie about
  // something deliberately dropped.
  if (!lookIn(pack, ref.look)) {
    return `That look is no longer in ${
      pack.name || pack.author || 'this pack'
    } — forgotten, or gone from the pack.`;
  }
  if (pack.sourceId && !packHost(pack.sourceId)) {
    return `Kept on ${pack.sourceId} — connect it to grade with this look.`;
  }
  return 'This look is not in this browser’s vault yet.';
}
