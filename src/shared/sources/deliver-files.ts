/**
 * Hand a rendered set over: a folder keeps the set together on disk where
 * the directory picker exists (Chromium), and where it does not each file is
 * downloaded in turn — the only thing a non-Chromium browser can do. The
 * dance Trips' `use-post-exports.ts` and the Studio each wrote for
 * themselves; the Develop tool is the third consumer, so it is written once
 * here.
 *
 * In TWO steps, and the order is the whole point: the folder is picked AT
 * THE CLICK (`pickDeliveryTarget`), the files are written to it once they
 * exist (`deliverFilesTo`). `showDirectoryPicker` opens only while the page
 * holds a transient user activation, which Chrome grants for about five
 * seconds after the click — so a picker asked for AFTER a render of any
 * length throws `SecurityError: Must be handling a user gesture`, and a
 * caller reading every rejection as "dismissed" delivers nothing and says
 * nothing. Measured (2026-09-20): one picture usually renders inside the
 * window, a whole roll never does. Ask first, render second.
 */

import { downloadBlob } from '../media/save';
import { canWriteToDisk, pickWritableDirectory, writeItems } from './write-files';

export type Delivery =
  | {
      method: 'folder';
      written: number;
      renamed: number;
      errors: string[];
      /** The names of the files that could NOT be written — what a caller must not count as delivered. */
      failed: string[];
    }
  | { method: 'download'; written: number };

/** Where a run will land, decided before it renders. */
export type DeliveryTarget =
  | { kind: 'folder'; dir: FileSystemDirectoryHandle }
  | { kind: 'download' };

export interface DeliverOptions {
  /**
   * Replace a file the chosen folder already holds under that name, or number
   * the incoming one. Only the folder can honour it: a DOWNLOAD is the
   * browser's, and it numbers a repeat by itself, whatever this says.
   */
  replace: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Ask where the run will land — to be called FIRST, from the click that
 * starts the export, while the browser still honours it. Null when the
 * person dismissed the picker; a picker refused for any other reason (no
 * activation left, a browser policy) is thrown with its own sentence, so the
 * run can say it instead of ending in silence.
 */
export async function pickDeliveryTarget(): Promise<DeliveryTarget | null> {
  if (!canWriteToDisk()) return { kind: 'download' };
  try {
    return { kind: 'folder', dir: await pickWritableDirectory() };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    if (e instanceof DOMException && e.name === 'SecurityError') {
      throw new Error('The folder picker must be opened from a click — the export waited too long to ask for it.');
    }
    throw e;
  }
}

/**
 * A file bound for a SUB-FOLDER of the chosen one — a second export target
 * (`develop/export-targets.ts`), a picture's variant (`Variant 2`), or both
 * (`Web/Variant 2`, one `/` per level): the file keeps its own name, the
 * folder says which target or variant it is. A download cannot make a folder,
 * so there the folders' names go before the file's instead
 * (`Web-Variant 2-DJI_0101.jpg`).
 */
export interface FolderedFile {
  file: File;
  folder: string;
}

/** Write the files where `pickDeliveryTarget` said. */
export async function deliverFilesTo(
  target: DeliveryTarget,
  files: readonly (File | FolderedFile)[],
  { replace, onProgress }: DeliverOptions,
): Promise<Delivery> {
  const items = files.map((f) => (f instanceof File ? { file: f, folder: '' } : f));
  const total = items.length;
  if (target.kind === 'folder') {
    let done = 0;
    const result = { written: 0, renamed: 0, errors: [] as string[], failed: [] as string[] };
    // One folder at a time, the chosen one first, in the order they came.
    const folders = [...new Set(items.map((i) => i.folder))];
    for (const folder of folders) {
      const these = items.filter((i) => i.folder === folder);
      let dir = target.dir;
      if (folder) {
        try {
          for (const level of folder.split('/').filter(Boolean)) {
            dir = await dir.getDirectoryHandle(level, { create: true });
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          for (const i of these) {
            result.errors.push(`${folder}/${i.file.name}: ${message}`);
            result.failed.push(`${folder}/${i.file.name}`);
          }
          done += these.length;
          onProgress?.(done, total);
          continue;
        }
      }
      const base = done;
      const res = await writeItems(dir, these.map((i) => ({ name: i.file.name, file: i.file })), {
        replace,
        onProgress: (n) => onProgress?.(base + n, total),
      });
      done += these.length;
      result.written += res.written;
      result.renamed += res.renamed;
      // A sub-folder's names carry the folder, so a caller counting what
      // landed in the chosen folder itself never mistakes one for the other.
      const at = (name: string) => (folder ? `${folder}/${name}` : name);
      result.errors.push(...res.errors.map((e) => `${at(e.name)}: ${e.message}`));
      result.failed.push(...res.errors.map((e) => at(e.name)));
    }
    return { method: 'folder', ...result };
  }
  for (const [i, f] of items.entries()) {
    downloadBlob(f.file, f.folder ? `${f.folder.split('/').filter(Boolean).join('-')}-${f.file.name}` : f.file.name);
    onProgress?.(i + 1, total);
  }
  return { method: 'download', written: total };
}
