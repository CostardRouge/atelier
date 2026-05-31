/**
 * Pure, dependency-free pairing of DJI video files with their telemetry SRT
 * siblings. No DOM, no React — reusable in any context (browser, Node, a
 * future native shell).
 *
 * DJI names by pair: `DJI_0001.MP4` ↔ `DJI_0001.SRT`. We group by base name
 * (filename without extension), case-insensitively.
 */

export interface MediaPair {
  /** Filename without extension, e.g. `DJI_0001`. */
  baseName: string;
  video: File;
  /** Matching telemetry file, or null if the video has no SRT sibling. */
  srt: File | null;
}

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

/**
 * Pair videos with their SRT siblings.
 *
 * - Groups by base name, case-insensitive on the extension.
 * - Videos without an SRT are still included (`srt: null`).
 * - Orphan SRTs (no matching video) are dropped.
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

    const { base, ext } = splitName(name);

    const isVideo = VIDEO_EXTENSIONS.includes(ext);
    const isSrt = ext === 'srt';

    // Ignore everything that isn't a recognised video or an SRT
    // (covers .LRF, .THM, and any other stray file).
    if (!isVideo && !isSrt) continue;

    const key = base.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { baseName: base, video: null, srt: null };
      groups.set(key, group);
    }

    if (isVideo) {
      // First video wins if duplicates exist; keep behaviour deterministic.
      if (!group.video) group.video = file;
    } else {
      if (!group.srt) group.srt = file;
    }
  }

  const pairs: MediaPair[] = [];
  for (const group of groups.values()) {
    // Drop orphan SRTs (no video).
    if (!group.video) continue;
    pairs.push({
      baseName: group.baseName,
      video: group.video,
      srt: group.srt,
    });
  }

  pairs.sort((a, b) => a.baseName.localeCompare(b.baseName));

  return pairs;
}
