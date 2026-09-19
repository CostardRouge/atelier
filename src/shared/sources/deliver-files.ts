/**
 * Hand a rendered set over: a folder keeps the set together on disk where
 * the directory picker exists (Chromium), and where it does not each file is
 * downloaded in turn — the only thing a non-Chromium browser can do. The
 * dance Trips' `use-post-exports.ts` and the Studio each wrote for
 * themselves; the Develop tool is the third consumer, so it is written once
 * here (the two older copies can move onto it).
 */

import { downloadBlob } from '../media/save';
import { canWriteToDisk, pickWritableDirectory, writeItems } from './write-files';

export type Delivery =
  | { method: 'folder'; written: number; errors: string[] }
  | { method: 'download'; written: number }
  | { method: 'dismissed' };

export async function deliverFiles(
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<Delivery> {
  if (canWriteToDisk()) {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await pickWritableDirectory();
    } catch {
      return { method: 'dismissed' };
    }
    const res = await writeItems(
      dir,
      files.map((f) => ({ name: f.name, file: f })),
      (done, total) => onProgress?.(done, total),
    );
    return { method: 'folder', written: res.written, errors: res.errors.map((e) => `${e.name}: ${e.message}`) };
  }
  for (const [i, f] of files.entries()) {
    downloadBlob(f, f.name);
    onProgress?.(i + 1, files.length);
  }
  return { method: 'download', written: files.length };
}
