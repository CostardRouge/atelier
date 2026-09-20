/**
 * Copies files into a directory the user chose via the File System Access API.
 * Works with any `FileSystemDirectoryHandle`, so it can be exercised headless
 * against OPFS (`navigator.storage.getDirectory()`).
 *
 * Salvaged from the retired Cull tool for the unified studio's
 * export-to-folder path.
 */

import { uniqueNameAsync } from './unique-name';

/** A file to write, with its destination name (flat, de-duplicated upstream). */
export interface WriteItem {
  name: string;
  file: File;
}

export interface WriteResult {
  written: number;
  bytes: number;
  /** How many were written under a number because the folder already held that name. */
  renamed: number;
  errors: { name: string; message: string }[];
}

export type WriteProgress = (done: number, total: number, name: string) => void;

export interface WriteOptions {
  /**
   * Replace a file the folder already holds under that name, or number the
   * incoming one (`DJI_0101-1.jpg`). Required, with no default: a write that
   * replaces is not undoable, and every caller should say which it means.
   */
  replace: boolean;
  onProgress?: WriteProgress;
}

/** True when the directory picker is available (Chromium-based browsers). */
export function canWriteToDisk(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
}
type ShowDirectoryPicker = (
  opts?: DirectoryPickerOptions,
) => Promise<FileSystemDirectoryHandle>;

/**
 * Prompt for a writable directory. Isolated here so the one unavoidable cast
 * (the picker isn't in every lib.dom yet) doesn't leak into components. Named
 * apart from `file-sources.pickDirectory`, which picks a directory to *read*.
 * Throws `AbortError` if the user dismisses the dialog.
 */
export function pickWritableDirectory(): Promise<FileSystemDirectoryHandle> {
  const fn = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker })
    .showDirectoryPicker;
  if (!fn) throw new Error('Directory picker not supported');
  return fn({ mode: 'readwrite' });
}

/**
 * Whether `dir` already holds something under `name`. A name that is there
 * but is not a file (a directory, say) counts as taken: it cannot be written
 * to either. The question goes to the real file system, so a case-insensitive
 * volume answers about `DJI_0101.JPG` when asked about `DJI_0101.jpg` — which
 * is exactly what should stop an export from landing on its own original.
 */
async function nameTaken(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    return !(e instanceof DOMException && e.name === 'NotFoundError');
  }
}

/**
 * Write every item into `dir` (flat). Per-file failures are collected, not
 * thrown. Under `replace: false` a name the folder already holds is numbered
 * rather than overwritten, and the count comes back in `renamed`.
 */
export async function writeItems(
  dir: FileSystemDirectoryHandle,
  items: WriteItem[],
  { replace, onProgress }: WriteOptions,
): Promise<WriteResult> {
  const result: WriteResult = { written: 0, bytes: 0, renamed: 0, errors: [] };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    try {
      // Each name is asked about as its turn comes, so a file written a
      // moment ago by this same run is one the next one steps around.
      const name = replace ? item.name : await uniqueNameAsync(item.name, (c) => nameTaken(dir, c));
      if (name !== item.name) result.renamed += 1;
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(item.file);
      await writable.close();
      result.written += 1;
      result.bytes += item.file.size;
    } catch (e) {
      result.errors.push({
        name: item.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    onProgress?.(i + 1, items.length, item.name);
  }
  return result;
}
