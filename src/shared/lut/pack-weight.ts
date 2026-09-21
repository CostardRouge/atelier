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
