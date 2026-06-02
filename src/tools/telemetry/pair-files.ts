/**
 * Pure, dependency-free pairing of DJI video files with their telemetry SRT
 * siblings. No DOM, no React — reusable in any context (browser, Node, a
 * future native shell).
 *
 * DJI names by pair: `DJI_0001.MP4` ↔ `DJI_0001.SRT`. We group by base name
 * (filename without extension), case-insensitively. A pair always holds at
 * least one of the two files; the other slot can be filled later by the user.
 */

export interface MediaPair {
  /** Stable identity for React keys and selection (lowercased base name). */
  id: string;
  /** Filename without extension, e.g. `DJI_0001`. */
  baseName: string;
  /** The video file, or null if not yet provided. */
  video: File | null;
  /** The telemetry file, or null if not yet provided. */
  srt: File | null;
  /** True when a manually-attached video's base name differs from baseName. */
  videoNameMismatch?: boolean;
  /** True when a manually-attached SRT's base name differs from baseName. */
  srtNameMismatch?: boolean;
}

export type FileKind = 'video' | 'srt' | 'other';

/** Accepted video extensions (compared case-insensitively). */
const VIDEO_EXTENSIONS = ['mp4', 'mov'];

/** Split a filename into `{ base, ext }`; ext is lowercased, no leading dot. */
function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    // No extension, or a dotfile like `.DS_Store` (dot at index 0).
    return { base: name, ext: '' };
  }
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

/** Classify a filename as a video, an SRT, or something we ignore. */
export function classifyFile(name: string): FileKind {
  const { ext } = splitName(name);
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (ext === 'srt') return 'srt';
  return 'other';
}

/** The base name (without extension) of a file, for display/comparison. */
export function fileBaseName(name: string): string {
  return splitName(name).base;
}

/**
 * Pair videos with their SRT siblings.
 *
 * - Groups by base name, case-insensitive on the extension.
 * - A group is kept as long as it has a video OR an SRT — so a lone video
 *   ("missing telemetry") and a lone SRT ("missing video") both appear, ready
 *   for the user to complete.
 * - Junk is ignored: `.LRF` proxies, `.THM`, hidden dotfiles, and anything
 *   that is neither a video nor an SRT.
 * - Result is sorted by base name for stable, predictable ordering.
 */
export function pairFiles(files: File[]): MediaPair[] {
  // Group by lowercased base name so casing differences between a video and
  // its SRT don't prevent a match. Preserve the first-seen original base name
  // for display.
  const groups = new Map<
    string,
    { baseName: string; video: File | null; srt: File | null }
  >();

  for (const file of files) {
    const name = file.name;

    // Skip hidden files (leading dot).
    if (name.startsWith('.')) continue;

    const kind = classifyFile(name);
    // Ignore everything that isn't a recognised video or an SRT
    // (covers .LRF, .THM, and any other stray file).
    if (kind === 'other') continue;

    const base = fileBaseName(name);
    const key = base.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { baseName: base, video: null, srt: null };
      groups.set(key, group);
    }

    if (kind === 'video') {
      // First video wins if duplicates exist; keep behaviour deterministic.
      if (!group.video) group.video = file;
    } else {
      if (!group.srt) group.srt = file;
    }
  }

  const pairs: MediaPair[] = [];
  for (const [key, group] of groups) {
    pairs.push({
      id: key,
      baseName: group.baseName,
      video: group.video,
      srt: group.srt,
    });
  }

  pairs.sort((a, b) => a.baseName.localeCompare(b.baseName));

  return pairs;
}

/**
 * Attach a manually-chosen file to a pair, filling its video or SRT slot. The
 * file is accepted as-is (no blocking) but flagged with a name-mismatch marker
 * when its base name differs from the pair's, so the UI can warn discreetly.
 *
 * Returns a new pair; unknown file kinds are ignored (pair returned unchanged).
 */
export function attachToPair(pair: MediaPair, file: File): MediaPair {
  const kind = classifyFile(file.name);
  if (kind === 'other') return pair;

  const mismatch =
    fileBaseName(file.name).toLowerCase() !== pair.baseName.toLowerCase();

  if (kind === 'video') {
    return { ...pair, video: file, videoNameMismatch: mismatch };
  }
  return { ...pair, srt: file, srtNameMismatch: mismatch };
}

/** Undo an attachment, clearing the given slot and its mismatch flag. */
export function detachFromPair(
  pair: MediaPair,
  kind: 'video' | 'srt',
): MediaPair {
  if (kind === 'video') {
    return { ...pair, video: null, videoNameMismatch: false };
  }
  return { ...pair, srt: null, srtNameMismatch: false };
}
