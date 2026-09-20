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
  | { method: 'folder'; written: number; renamed: number; errors: string[] }
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

/** Write the files where `pickDeliveryTarget` said. */
export async function deliverFilesTo(
  target: DeliveryTarget,
  files: readonly File[],
  { replace, onProgress }: DeliverOptions,
): Promise<Delivery> {
  if (target.kind === 'folder') {
    const res = await writeItems(target.dir, files.map((f) => ({ name: f.name, file: f })), {
      replace,
      onProgress: (done, total) => onProgress?.(done, total),
    });
    return {
      method: 'folder',
      written: res.written,
      renamed: res.renamed,
      errors: res.errors.map((e) => `${e.name}: ${e.message}`),
    };
  }
  for (const [i, f] of files.entries()) {
    downloadBlob(f, f.name);
    onProgress?.(i + 1, files.length);
  }
  return { method: 'download', written: files.length };
}
