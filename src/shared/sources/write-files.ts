/**
 * Copies files into a directory the user chose via the File System Access API.
 * Works with any `FileSystemDirectoryHandle`, so it can be exercised headless
 * against OPFS (`navigator.storage.getDirectory()`).
 *
 * Salvaged from the retired Cull tool for the unified studio's
 * export-to-folder path.
 */

/** A file to write, with its destination name (flat, de-duplicated upstream). */
export interface WriteItem {
  name: string;
  file: File;
}

export interface WriteResult {
  written: number;
  bytes: number;
  errors: { name: string; message: string }[];
}

export type WriteProgress = (done: number, total: number, name: string) => void;

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

/** Write every item into `dir` (flat). Per-file failures are collected, not thrown. */
export async function writeItems(
  dir: FileSystemDirectoryHandle,
  items: WriteItem[],
  onProgress?: WriteProgress,
): Promise<WriteResult> {
  const result: WriteResult = { written: 0, bytes: 0, errors: [] };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    try {
      const handle = await dir.getFileHandle(item.name, { create: true });
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
