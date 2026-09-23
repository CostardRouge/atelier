/**
 * What the LUT vault WEIGHS — per look, per pack, and in total, here and on
 * the instance a pack is kept on.
 *
 * The maintainer asked for it in the words of someone who had just imported a
 * YouTuber's whole pack: *"il y a des looks que je n'utiliserai jamais comme
 * le Sony, comme les fichiers films, c'est des caméras que je ne possède
 * pas"* — and *"peut-être donner de la visibilité en fait sur le poids de ce
 * que l'on stocke, ça permettra peut-être à l'utilisateur de gérer un peu ses
 * packs"*. The cap is not the point; knowing is. A pack is 41 MB of lattices
 * (`docs/lut-packs.md` §2) and until now nothing on screen said so.
 *
 * ## Two figures, two sources, and they are never mixed
 *
 * - **Here** is MEASURED, from the stored buffers themselves
 *   (`pack-store.ts`'s `storedLatticeSizes`). The index is not asked: it
 *   records what a look's `.cube` weighed, which is four times the encoded
 *   lattice (5.84 MB of text → 1.57 MB, `pack-codec.ts`), and a record could
 *   in principle disagree with the index that names it.
 * - **On the instance** is DERIVED, exactly, from the index's own grid size:
 *   an encoded lattice is `40 + size³ × 6` bytes and nothing else
 *   (`encodedBytes`). So no new Winnow route and no round trip is needed to
 *   say what a pack costs there — and the two figures agreeing is a free
 *   check on both.
 *
 * Neither is ever guessed. A look whose index records no grid size is counted
 * as **unweighed** and said out loud, exactly as the suite draws `—` for a
 * telemetry value it does not have rather than inventing one.
 *
 * ## Bytes are counted ONCE
 *
 * Both stores are content-addressed — the vault by the source `.cube`'s
 * SHA-256, the instance's file store by the encoded lattice's (`PackLook.blob`
 * — the two hashes are different numbers, see `lut-pack.ts`). Two looks that
 * encode to the same lattice share one stored copy, so every total here is
 * summed over DISTINCT keys. A pack that ships the same cube twice does not
 * weigh twice, and the vault total is not the sum of the pack totals when two
 * packs share a look.
 *
 * ## And so: what a forget gives back
 *
 * The same counting answers the other half of the ask — dropping a look must
 * free its bytes here and on the instance, and must leave alone a lattice
 * another look still names (`freedHashes` / `freedBlobs`). It lives beside
 * the weighing because it IS the weighing, asked the other way round.
 *
 * Pure and DOM-free: indexes and a map of measured sizes in, numbers out.
 */

import type { LutPackIndex, PackLook } from './lut-pack';
import { encodedBytes } from './pack-codec';

/** Measured sizes by lattice hash, as `pack-store.ts` reads them off the vault. */
export type LatticeSizes = ReadonlyMap<string, number>;

/** Where a look's bytes are, as far as this browser can tell. */
export type LookWhere =
  /** In this browser's vault — the bytes are on this device. */
  | 'here'
  /** Not here, but the instance the pack is kept on holds them. */
  | 'instance'
  /** Nowhere this browser knows of: an interrupted import, or a pack never pushed. */
  | 'nowhere';

/** One look's weight, and which of the two sources answered. */
export interface LookWeight {
  /** The encoded lattice's size in bytes, or null when nothing can say. */
  bytes: number | null;
  /** True when the number came off the stored buffer rather than off the index. */
  measured: boolean;
  where: LookWhere;
}

/** What a pack, or the whole vault, weighs. */
export interface Weight {
  /** Bytes on this device, measured, distinct lattices counted once. */
  here: number;
  /** Lattices this device holds. */
  hereLooks: number;
  /** Bytes on the instance, derived from the grid sizes, distinct blobs once. */
  instance: number;
  /** Looks the instance holds the bytes of — those that carry a `blob`. */
  instanceLooks: number;
  /** Looks counted. */
  looks: number;
  /** Looks nothing can weigh: no grid size recorded and no bytes here. */
  unweighed: number;
}

const EMPTY: Weight = {
  here: 0,
  hereLooks: 0,
  instance: 0,
  instanceLooks: 0,
  looks: 0,
  unweighed: 0,
};

/**
 * One look's size: measured where this device holds the bytes, else derived
 * from the grid the index recorded. The two are the same number by
 * construction — `encodedBytes` is exactly what was written — so a
 * disagreement would mean a truncated record, which is worth being able to
 * see rather than papering over.
 */
export function lookBytes(look: PackLook, sizes: LatticeSizes): number | null {
  const measured = look.hash ? sizes.get(look.hash) : undefined;
  if (measured !== undefined) return measured;
  return look.lattice ? encodedBytes(look.lattice) : null;
}

/** One look's weight and where its bytes are. */
export function lookWeight(
  pack: LutPackIndex,
  look: PackLook,
  sizes: LatticeSizes,
): LookWeight {
  const measured = look.hash ? sizes.get(look.hash) : undefined;
  if (measured !== undefined) return { bytes: measured, measured: true, where: 'here' };
  const derived = look.lattice ? encodedBytes(look.lattice) : null;
  // A `blob` is written into the index by the push that sent the bytes
  // (`pack-remote.ts`), so it is the one honest sign that an instance holds
  // them — and it means nothing without a pack kept somewhere to ask.
  const onInstance = !!pack.sourceId && !!look.blob;
  return { bytes: derived, measured: false, where: onInstance ? 'instance' : 'nowhere' };
}

/**
 * What a set of looks' lattices weigh, distinct lattices counted once — one
 * branch of a pack's tree, say.
 *
 * ONE number, not a here/there split, and that is honest rather than lazy:
 * `lookBytes` answers the same size either way, since the measured buffer and
 * `encodedBytes` agree by construction. So this reads "what these looks'
 * lattices weigh", wherever they are. A look nothing can weigh adds nothing —
 * `packWeight`'s `unweighed` is where that is said.
 */
export function looksBytes(looks: readonly PackLook[], sizes: LatticeSizes): number {
  const seen = new Set<string>();
  let bytes = 0;
  for (const look of looks) {
    const key = look.hash || look.id;
    if (seen.has(key)) continue;
    seen.add(key);
    bytes += lookBytes(look, sizes) ?? 0;
  }
  return bytes;
}

/** What one pack weighs, here and there. */
export function packWeight(pack: LutPackIndex, sizes: LatticeSizes): Weight {
  return weigh([pack], sizes);
}

/**
 * What the whole vault weighs — every pack at once, so a lattice two packs
 * share is counted once. Which is why this is not the sum of `packWeight`
 * over the packs, and why the screen must not add the rows up itself.
 */
export function vaultWeight(packs: readonly LutPackIndex[], sizes: LatticeSizes): Weight {
  return weigh(packs, sizes);
}

/** What each instance holds, by source id — for a vault kept in two places. */
export function instanceWeights(
  packs: readonly LutPackIndex[],
  sizes: LatticeSizes,
): Map<string, number> {
  const out = new Map<string, number>();
  const byHost = new Map<string, LutPackIndex[]>();
  for (const pack of packs) {
    if (!pack.sourceId) continue;
    byHost.set(pack.sourceId, [...(byHost.get(pack.sourceId) ?? []), pack]);
  }
  for (const [host, held] of byHost) out.set(host, weigh(held, sizes).instance);
  return out;
}

function weigh(packs: readonly LutPackIndex[], sizes: LatticeSizes): Weight {
  const hashes = new Set<string>();
  const blobs = new Set<string>();
  const out: Weight = { ...EMPTY };
  for (const pack of packs) {
    for (const look of pack.looks) {
      out.looks += 1;
      const w = lookWeight(pack, look, sizes);
      if (w.bytes === null) out.unweighed += 1;
      // Distinct keys only: the two stores are content-addressed, so a shared
      // lattice is one copy in each of them.
      if (w.where === 'here' && look.hash && !hashes.has(look.hash)) {
        hashes.add(look.hash);
        out.here += w.bytes ?? 0;
        out.hereLooks += 1;
      }
      if (pack.sourceId && look.blob && !blobs.has(look.blob)) {
        blobs.add(look.blob);
        out.instance += lookBytes(look, sizes) ?? 0;
        out.instanceLooks += 1;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------- what a forget frees */

/** What dropping some looks gives back, and what it must leave alone. */
export interface Freed {
  /** Keys no surviving look names: these bytes can go. */
  free: string[];
  /** Keys another look still names: kept, and worth saying so. */
  shared: string[];
}

/**
 * The lattice hashes forgetting these looks would free in THIS BROWSER'S
 * vault — the ones no surviving look of any pack still names.
 *
 * This is the rule the whole feature turns on: both stores are
 * content-addressed, so two packs shipping the same `.cube` share one stored
 * copy, and dropping a look from one of them must not take the other's bytes
 * with it. Deducing ownership from a record's own `packId` cannot answer it —
 * a `put` keyed on the hash overwrites that field with whichever pack stored
 * it last — so the question is asked of the INDEXES, here, where every pack
 * can be seen at once.
 */
export function freedHashes(
  packs: readonly LutPackIndex[],
  packId: string,
  lookIds: readonly string[],
): Freed {
  return freed(packs, packId, lookIds, (l) => l.hash, () => true);
}

/**
 * The same question in the FILE STORE's vocabulary: the blobs forgetting
 * these looks would free on one instance.
 *
 * Two differences from the vault's, both load-bearing. The key is `blob`, the
 * encoded lattice's hash, because a look's `hash` names nothing on an
 * instance (`lut-pack.ts`). And only the packs kept on THAT instance can
 * still be naming those bytes — a file store is per instance and per user, so
 * a pack kept somewhere else, or nowhere, has no say over them.
 */
export function freedBlobs(
  packs: readonly LutPackIndex[],
  packId: string,
  lookIds: readonly string[],
  sourceId: string,
): Freed {
  return freed(packs, packId, lookIds, (l) => l.blob, (p) => p.sourceId === sourceId);
}

function freed(
  packs: readonly LutPackIndex[],
  packId: string,
  lookIds: readonly string[],
  key: (look: PackLook) => string | undefined,
  counts: (pack: LutPackIndex) => boolean,
): Freed {
  const doomed = new Set(lookIds);
  const survivors = new Set<string>();
  const wanted = new Set<string>();
  for (const pack of packs) {
    if (!counts(pack)) continue;
    for (const look of pack.looks) {
      const k = key(look);
      if (!k) continue;
      if (pack.id === packId && doomed.has(look.id)) wanted.add(k);
      else survivors.add(k);
    }
  }
  const out: Freed = { free: [], shared: [] };
  for (const k of wanted) (survivors.has(k) ? out.shared : out.free).push(k);
  return out;
}

/** What a forget gave back, in the words the sheet prints. */
export interface ForgetResult {
  /** Bytes reclaimed in this browser's vault. */
  here: number;
  /** Bytes reclaimed on the instance, and which one it was. */
  instance: number;
  keptOn: string | null;
  /** Lattices a surviving look still names, so they stayed. */
  shared: number;
}

/**
 * That result as one sentence — the report, after the fact, of the same two
 * numbers the question quoted before it.
 *
 * It is a sentence and not a list of figures because of the case in the
 * middle: a look whose lattice another look holds frees NOTHING, and
 * "0 KB back here · 1 kept" is a worse way of saying so than saying so.
 */
export function forgotten(result: ForgetResult): string {
  if (result.here <= 0) {
    return result.shared > 0
      ? 'no bytes came back: another look holds the same lattice.'
      : 'it held no bytes here.';
  }
  const there =
    result.instance > 0 && result.keptOn ? ` and ${formatBytes(result.instance)} on ${result.keptOn}` : '';
  return `${formatBytes(result.here)} back here${there}.`;
}

/** What a set of lattice hashes weighs here — the bytes a forget gives back. */
export function hashBytes(hashes: readonly string[], sizes: LatticeSizes): number {
  return hashes.reduce((sum, hash) => sum + (sizes.get(hash) ?? 0), 0);
}

/**
 * What a set of blobs weighs on an instance, derived from the grid sizes the
 * indexes record — the same arithmetic as everywhere else here, since the
 * instance is never asked how big its own files are.
 */
export function blobBytes(blobs: readonly string[], packs: readonly LutPackIndex[]): number {
  const size = new Map<string, number>();
  for (const pack of packs) {
    for (const look of pack.looks) {
      if (look.blob && look.lattice && !size.has(look.blob)) {
        size.set(look.blob, encodedBytes(look.lattice));
      }
    }
  }
  return blobs.reduce((sum, blob) => sum + (size.get(blob) ?? 0), 0);
}

/**
 * What a look's weight cell SAYS — the size, and a word when the bytes are
 * not on this device.
 *
 * The word matters: a colour alone would carry the whole distinction, which
 * is unreadable to anyone who cannot see it and unreadable in a screenshot.
 * `there` is the instance the pack is kept on; `missing` is a look the index
 * names whose lattice is neither here nor pushed — an interrupted import, or
 * a pack adopted and then forgotten on the instance. A dash is the honest
 * answer when the index records no grid size to derive one from.
 */
export function lookWeightLabel(weight: LookWeight): string {
  if (weight.bytes === null) return '—';
  const size = formatBytes(weight.bytes);
  if (weight.where === 'here') return size;
  return weight.where === 'instance' ? `${size} there` : `${size} missing`;
}

/** The same, as the sentence its `title` carries. */
export function lookWeightNote(weight: LookWeight, keptOn: string | null): string {
  if (weight.bytes === null) return 'This pack’s index does not record this look’s size.';
  if (weight.where === 'here') return 'In this browser’s vault.';
  if (weight.where === 'instance') {
    return `Not in this browser — kept on ${keptOn ?? 'the instance'}, and it downloads when a picture asks for it.`;
  }
  return 'Neither in this browser nor on an instance: nothing here holds its bytes.';
}

/**
 * Bytes as a person reads them. Binary units under decimal names, exactly as
 * the import sheet has always printed them, because that is what every OS the
 * maintainer uses prints — and a look is never so big that the difference
 * matters to a decision about it.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
