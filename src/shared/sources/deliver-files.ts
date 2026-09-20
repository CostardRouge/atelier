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
  | { method: 'folder'; written: number; renamed: number; errors: string[] }
  | { method: 'download'; written: number }
  | { method: 'dismissed' };

export interface DeliverOptions {
  /**
   * Replace a file the chosen folder already holds under that name, or number
   * the incoming one. Only the folder can honour it: a DOWNLOAD is the
   * browser's, and it numbers a repeat by itself, whatever this says.
   */
  replace: boolean;
  onProgress?: (done: number, total: number) => void;
}

export async function deliverFiles(
  files: readonly File[],
  { replace, onProgress }: DeliverOptions,
): Promise<Delivery> {
  if (canWriteToDisk()) {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await pickWritableDirectory();
    } catch {
      return { method: 'dismissed' };
    }
    const res = await writeItems(dir, files.map((f) => ({ name: f.name, file: f })), {
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
