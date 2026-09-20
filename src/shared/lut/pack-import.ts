/**
 * Reading a folder of purchased `.cube` files into the vault.
 *
 * One pass per file: read the bytes, hash them, parse the text, encode the
 * lattice, store it, bake its thumbnail. The INDEX is built from the paths
 * (`lut-pack.ts`) and written last, so a pack only ever exists with the
 * lattices it names — an interrupted import leaves stored bytes nobody points
 * at, which the next import recognises by hash and skips.
 *
 * The maintainer's pack is 25 files of ~6 MB; measured on his Mac a file is
 * ~70 ms to parse and ~25 ms for the rest, so the whole import is a couple of
 * seconds — but it is a couple of seconds with 6 MB strings in flight, so the
 * loop yields between files and never holds two.
 *
 * Nothing here belongs to a tool: the import is the vault's, and the screen
 * over it (`LutPackImportModal`) only collects names and shows progress.
 */

import { parseCube } from '../lib/cube-parser';
import {
  buildPackIndex,
  familyFor,
  type LutPackIndex,
  type PackFamily,
  type PackFileEntry,
} from './lut-pack';
import { encodeLattice, sha256Hex } from './pack-codec';
import { storedLatticeHashes } from './pack-store';
import { bakeLookThumb } from './pack-thumbs';
import { savePack, saveLookLattice } from './pack-vault';

/** Where an import has got to — one call per file, before it is read. */
export interface ImportProgress {
  done: number;
  total: number;
  /** The file being read, as the author named it. */
  file: string;
}

/** A file the import could not take, and why — said, never swallowed. */
export interface ImportFailure {
  file: string;
  reason: string;
}

export interface PackImportResult {
  index: LutPackIndex;
  failed: ImportFailure[];
  /** Looks whose bytes this device already held, by hash — nothing re-stored. */
  reused: number;
  /** What the import wrote, in bytes. */
  stored: number;
}

export interface PackImportOptions {
  id: string;
  name: string;
  author: string;
  url?: string;
  hidden?: readonly string[];
  /** Skip baking thumbnails — the tests, and a re-import that only re-reads names. */
  thumbs?: boolean;
  onProgress?: (progress: ImportProgress) => void;
}

/** The `.cube` files of a picked folder, in a stable order. */
export function cubeEntries(files: readonly { path: string; file: File }[]): {
  path: string;
  file: File;
}[] {
  return files
    .filter(({ path }) => /\.cube$/i.test(path) && !path.split('/').some((p) => p.startsWith('.')))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Read a picked folder into the vault and return the pack it made.
 *
 * A file that cannot be read or parsed is REPORTED and left out of the index:
 * a pack that silently lost three of its looks is worse than one that says
 * which three.
 */
export async function importPackFromFolder(
  picked: readonly { path: string; file: File }[],
  options: PackImportOptions,
): Promise<PackImportResult> {
  const entries = cubeEntries(picked);
  const failed: ImportFailure[] = [];
  const measured: PackFileEntry[] = [];
  const thumbs = new Map<string, string>();
  const known = await storedLatticeHashes();
  let reused = 0;
  let stored = 0;

  for (const [i, entry] of entries.entries()) {
    options.onProgress?.({ done: i, total: entries.length, file: entry.path });
    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      // The TEXT is decoded from the bytes already read: reading the file
      // twice would double the peak for a 6 MB look.
      const lut = parseCube(new TextDecoder().decode(bytes));
      if (!lut) {
        failed.push({ file: entry.path, reason: 'Not a 3D .cube LUT (1D LUTs are not supported).' });
        continue;
      }
      if (known.has(hash)) {
        reused += 1;
      } else {
        const encoded = encodeLattice(lut);
        const ok = await saveLookLattice(options.id, hash, encoded);
        if (!ok) {
          failed.push({ file: entry.path, reason: 'This browser refused to store it (storage full?).' });
          continue;
        }
        stored += encoded.byteLength;
      }
      measured.push({ path: entry.path, bytes: entry.file.size, lattice: lut.size, hash });
      if (options.thumbs !== false) {
        const family = familyOfPath(entry.path);
        const thumb = await bakeLookThumb(lut, family);
        if (thumb) thumbs.set(entry.path, thumb);
      }
    } catch (e) {
      failed.push({ file: entry.path, reason: (e as Error).message || 'Could not read it.' });
    }
    // One file at a time, with a tick between: the strings are megabytes and
    // the page must stay alive while this runs.
    await new Promise((r) => setTimeout(r, 0));
  }

  const index = buildPackIndex(measured, {
    id: options.id,
    name: options.name,
    author: options.author,
    ...(options.url ? { url: options.url } : {}),
    hidden: options.hidden,
  });
  const withThumbs: LutPackIndex = {
    ...index,
    looks: index.looks.map((l) => {
      const thumb = thumbs.get(l.file);
      return thumb ? { ...l, thumb } : l;
    }),
  };
  await savePack(withThumbs);
  options.onProgress?.({ done: entries.length, total: entries.length, file: '' });
  return { index: withThumbs, failed, reused, stored };
}

/**
 * The family a file's own category names, for the thumbnail — the index is
 * only built at the end, and a thumbnail is baked as the file is read.
 * `familyFor` reads the top folder, which is exactly what this passes it.
 */
function familyOfPath(path: string): PackFamily {
  const [category] = path.split('/');
  return familyFor(path.includes('/') ? category : '');
}
