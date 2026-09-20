/**
 * "Upload .cube" writing into the VAULT instead of into the document.
 *
 * ## The leak this closes
 *
 * Until now an uploaded look was kept as the layer's `customText` — the whole
 * `.cube` text, inline — so it rode every trip, project and roll export file
 * and every Winnow document sync. A 65³ lattice is 3.6–6.9 MB of ASCII; only
 * the house style ever filtered it out (`isUploadedLook`, `saved-grade.ts`).
 * That is the exact opposite of the maintainer's hard rule, which weighs as
 * much as the licence: **a document carries a REFERENCE, never a lattice**
 * (`docs/lut-packs.md` §3, rule 1 and §3.1).
 *
 * So an upload now does what importing a pack does: the bytes go into the
 * vault keyed by their SHA-256, and the layer stores ~200 bytes naming them.
 *
 * ## One personal pack, not one pack per upload
 *
 * The plan's words are "a one-look personal pack". Taken literally that mints
 * a NEW pack per upload, and the picker's rail lists one row per pack
 * (§6) — ten uploaded cubes would be ten families of one look each, which is
 * exactly the pile the rail exists to avoid. So every upload lands in ONE
 * standing personal pack instead, each upload a look at its root. That also
 * makes "Keep on <instance>" mean something: one gesture pushes every look
 * this browser has uploaded, rather than needing one per pack.
 *
 * ## What is NOT changed
 *
 * `restore-grade.ts`'s `source: 'custom'` branch stays exactly as it was. A
 * document written before today still holds an inlined lattice, and it must
 * keep rendering — so this change is purely additive: new uploads take the
 * vault road, old documents keep theirs. Nothing is migrated, and the
 * maintainer confirmed no stored trip holds a PURCHASED lattice (§3.1).
 */

import { parseCube, type CubeLut } from '../lib/cube-parser';
import {
  familyForLookName,
  slug,
  type LutPackIndex,
  type PackLook,
  type PackRef,
} from './lut-pack';
import { encodeLattice, sha256Hex } from './pack-codec';
import { storedLatticeHashes } from './pack-store';
import { bakeLookThumb } from './pack-thumbs';
import { loadPacks, packsSnapshot, savePack, saveLookLattice } from './pack-vault';

/**
 * The standing personal pack. A FIXED id, not a minted one: it is the same
 * library on every device, and the id is what a stored reference already
 * written into a trip names.
 */
export const UPLOAD_PACK_ID = 'pk_uploads';

/** What the picker and the credits popover call it. */
export const UPLOAD_PACK_NAME = 'My looks';

export interface UploadedLook {
  ref: PackRef;
  /** How the layer is named in the stack. */
  name: string;
  /** The parsed lattice, so the caller grades immediately without a round trip. */
  lut: CubeLut;
}

/** A look's label: the author's own file name, minus the extension. */
export function uploadedLabel(fileName: string): string {
  return fileName.replace(/\.cube$/i, '').trim() || fileName;
}

/**
 * Read an uploaded `.cube` into the vault and answer the reference a layer
 * should store.
 *
 * Throws with a readable message rather than falling back to an inlined
 * lattice: silently reintroducing the leak to save an upload would defeat the
 * whole change, and the panel says what went wrong.
 */
export async function uploadLookIntoVault(file: File): Promise<UploadedLook> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The TEXT is decoded from the bytes already read — reading the file twice
  // doubles the peak for a 6 MB look (`pack-import.ts` makes the same trade).
  const lut = parseCube(new TextDecoder().decode(bytes));
  if (!lut) {
    throw new Error(`${file.name} isn’t a supported 3D .cube LUT (1D LUTs aren’t).`);
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // http on a bare IP, say. The hash IS the key, so there is no honest
    // half-measure here.
    throw new Error('This browser cannot hash the file (the page must be served over https).');
  }

  const hash = await sha256Hex(bytes);
  const known = await storedLatticeHashes();
  if (!known.has(hash)) {
    const ok = await saveLookLattice(UPLOAD_PACK_ID, hash, encodeLattice(lut));
    if (!ok) throw new Error('This browser refused to store the look (storage full?).');
  }

  await loadPacks();
  const pack = packsSnapshot().find((p) => p.id === UPLOAD_PACK_ID) ?? emptyUploadPack();
  const label = uploadedLabel(file.name);

  // The same file uploaded twice is the same look: matched on the HASH, so a
  // renamed copy is recognised too, and the stack gets the existing reference
  // rather than a second row pointing at the same bytes.
  const existing = pack.looks.find((l) => l.hash === hash);
  if (existing) {
    return { ref: { pack: pack.id, look: existing.id, hash }, name: existing.label, lut };
  }

  const family = familyForLookName(file.name);
  const thumb = await bakeLookThumb(lut, family);
  const look: PackLook = {
    id: uniqueLookId(pack, slug(label)),
    label,
    node: '',
    file: file.name,
    family,
    lattice: lut.size,
    bytes: file.size,
    hash,
    ...(thumb ? { thumb } : {}),
  };
  await savePack({ ...pack, looks: [...pack.looks, look] });
  return { ref: { pack: pack.id, look: look.id, hash }, name: label, lut };
}

function emptyUploadPack(): LutPackIndex {
  return {
    id: UPLOAD_PACK_ID,
    name: UPLOAD_PACK_NAME,
    author: '',
    tree: [],
    looks: [],
    hidden: [],
  };
}

/** Two files can share a label; their ids may not, since a reference names one. */
function uniqueLookId(pack: LutPackIndex, base: string): string {
  let id = base;
  for (let n = 2; pack.looks.some((l) => l.id === id); n += 1) id = `${base}-${n}`;
  return id;
}
