/**
 * Telling two files apart when they want the same name.
 *
 * An export is named after the picture it came from (`roll-export.ts`'s
 * `exportName`), which is the maintainer's own convention: his Gallery holds
 * the developed file under the capture's own name, and that is what pairs the
 * two folders by eye and what Winnow's `reconcile` would pair by basename. The
 * cost of that convention is collisions — two crops of one picture in a run,
 * or a second export into a folder that already holds the first — and the
 * answer is a number, not a date: `DJI_0101-1.jpg`, `-2`, `-3` (the
 * maintainer's call, 2026-09-20 — a stamp is longer and reads worse).
 *
 * The comparison is the CALLER's, through `taken`, because the two cases do
 * not compare alike: a run compares what it has already named, a folder
 * compares what is on disk — and a macOS volume is case-insensitive, so
 * `DJI_0101.jpg` and `DJI_0101.JPG` are one file there and both callers here
 * fold case before asking.
 *
 * Pure and DOM-free.
 */

/** How many numbered names to try before giving up rather than looping. */
export const UNIQUE_NAME_LIMIT = 999;

export interface SplitName {
  /** Everything before the last dot — the whole name when there is none. */
  base: string;
  /** The last dot and what follows (`.jpg`), or an empty string. */
  ext: string;
}

/**
 * A file name in two halves. A leading dot is part of the BASE (`.gitignore`
 * is a name, not an extension), so a numbered twin of it stays hidden.
 */
export function splitName(name: string): SplitName {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/** `DJI_0101.jpg` + 2 → `DJI_0101-2.jpg`; 0 gives the name back. */
export function numberedName(name: string, n: number): string {
  if (n <= 0) return name;
  const { base, ext } = splitName(name);
  return `${base}-${n}${ext}`;
}

/**
 * `name` itself when nothing has it, else the first free `name-1`, `name-2`…
 * `taken` decides what "has it" means and is asked about each candidate in
 * turn, so a caller that writes as it goes must count what it just took.
 *
 * Throws past `UNIQUE_NAME_LIMIT` rather than looping: a caller collects that
 * as one file's failure, which is what a folder holding a thousand twins
 * deserves to be told.
 */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  for (let n = 1; n <= UNIQUE_NAME_LIMIT; n += 1) {
    const candidate = numberedName(name, n);
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`there are already ${UNIQUE_NAME_LIMIT} files named like ${name}`);
}

/**
 * The same names with the repeats numbered, in order — the first keeps the
 * plain name. Case-folded, because the volume this lands on most likely is.
 */
export function dedupeNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const free = uniqueName(name, (candidate) => used.has(candidate.toLowerCase()));
    used.add(free.toLowerCase());
    return free;
  });
}
