/**
 * File access layer — the ONLY brick that changes for a native shell
 * (Tauri/Electron OS directory access, watching, persistent re-access).
 *
 * All three browser entry paths converge on the same internal shape: a
 * `Promise<File[]>`. The rest of the pipeline (pairing, summary, gallery,
 * player) is agnostic to where the files came from.
 *
 * Nothing is uploaded and no video bytes are read here: a `File` is a lazy
 * reference to the file on disk. Listing 50 multi-GB videos is instant.
 */

// --- Minimal typings for the File System Access API (not in all lib.dom). ---

interface FsFileHandle {
  kind: 'file';
  getFile(): Promise<File>;
}
interface FsDirHandle {
  kind: 'directory';
  values(): AsyncIterable<FsFileHandle | FsDirHandle>;
}
interface WindowWithFsApi extends Window {
  showDirectoryPicker?: () => Promise<FsDirHandle>;
}

// --- Minimal typings for the drag-and-drop entries API (webkit prefixed). ---

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (file: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      cb: (entries: FsEntry[]) => void,
      err?: (e: unknown) => void,
    ) => void;
  };
}

/** True when the File System Access directory picker is available (Chromium). */
export function supportsDirectoryPicker(): boolean {
  return typeof (window as WindowWithFsApi).showDirectoryPicker === 'function';
}

/** Recursively collect every file under a File System Access directory handle. */
async function collectFromDirHandle(
  dir: FsDirHandle,
  out: File[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      out.push(await entry.getFile());
    } else {
      await collectFromDirHandle(entry, out);
    }
  }
}

/**
 * Preferred path (Chromium): native directory picker. Throws `AbortError` if
 * the user cancels — callers should treat that as "no selection".
 */
async function pickViaFsApi(): Promise<File[]> {
  const picker = (window as WindowWithFsApi).showDirectoryPicker;
  if (!picker) throw new Error('showDirectoryPicker unavailable');
  const dir = await picker();
  const files: File[] = [];
  await collectFromDirHandle(dir, files);
  return files;
}

/**
 * Fallback (Firefox, Safari): a hidden `<input webkitdirectory>` that lets the
 * user choose a folder. Resolves with the contained files, or `[]` if the
 * dialog is dismissed without a selection.
 */
function pickViaInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // `webkitdirectory` is non-standard but widely supported for folder picks.
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory =
      true;

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      resolve(files);
    };

    input.onchange = () => finish(Array.from(input.files ?? []));
    // If the dialog is cancelled there is no reliable event; resolve empty when
    // focus returns to the window without a change firing.
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish([]), 300),
      { once: true },
    );

    input.click();
  });
}

/**
 * Open a directory and return its files. Uses the File System Access API when
 * available, otherwise the `<input webkitdirectory>` fallback.
 */
export async function pickDirectory(): Promise<File[]> {
  if (supportsDirectoryPicker()) {
    try {
      return await pickViaFsApi();
    } catch (err) {
      // User cancelled the native picker → no selection.
      if (err instanceof DOMException && err.name === 'AbortError') return [];
      throw err;
    }
  }
  return pickViaInput();
}

/**
 * Pick individual files (one or more `.mp4`/`.mov` plus their `.srt`) via a
 * plain `<input type="file" multiple>` — no `webkitdirectory`. For users who
 * just want to load a single clip and its telemetry without a whole folder.
 * Resolves with the chosen files, or `[]` if the dialog is dismissed.
 */
export function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/*,.mp4,.mov,.srt,text/plain';

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      resolve(files);
    };

    input.onchange = () => finish(Array.from(input.files ?? []));
    // No reliable cancel event — resolve empty once focus returns without a change.
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish([]), 300),
      { once: true },
    );

    input.click();
  });
}

/** Recursively read a dropped drag-and-drop entry into files. */
function readDropEntry(entry: FsEntry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve) => {
      entry.file!(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    return new Promise((resolve) => {
      const all: FsEntry[] = [];
      // readEntries returns at most ~100 entries per call; keep reading until
      // it returns an empty batch.
      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              Promise.all(all.map(readDropEntry)).then((nested) =>
                resolve(nested.flat()),
              );
              return;
            }
            all.push(...batch);
            readBatch();
          },
          () => resolve([]),
        );
      };
      readBatch();
    });
  }

  return Promise.resolve([]);
}

/**
 * Extract files from a drag-and-drop `DataTransfer`, recursing into any dropped
 * folders via `webkitGetAsEntry`. Falls back to the flat `files` list when the
 * entries API is unavailable.
 */
export async function filesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((item) =>
      'webkitGetAsEntry' in item
        ? (item.webkitGetAsEntry() as unknown as FsEntry | null)
        : null,
    )
    .filter((e): e is FsEntry => e !== null);

  if (entries.length === 0) {
    // No entries API — use the plain file list (no folder recursion).
    return Array.from(dataTransfer.files ?? []);
  }

  const nested = await Promise.all(entries.map(readDropEntry));
  return nested.flat();
}
