/**
 * Telling two documents apart when they want the same name.
 *
 * A clone starts from its original's name, and two trips (or projects) of one
 * name in one source cannot be told apart in a gallery. The rule is the one
 * `unique-name.ts` settled for exported files — a number, the first free one,
 * never a date — written for a NAME people read rather than a file: the number
 * is in parentheses, `Maroc (2)`, because it is the only style that needs no
 * guessing. `Route 66 2` leaves a reader unsure whether 66 is a clone marker;
 * `Route 66 (2)` does not (the maintainer's pick of the lab, 2026-10-09).
 *
 * - A name nothing else carries is kept as it is: cloning `Australia` onto an
 *   instance that has no `Australia` yields `Australia`.
 * - A taken name loses a clone suffix it already wears (`Maroc (2)` →
 *   `Maroc`) and takes the first free number from 2, so a gap left by a
 *   deletion is reused.
 * - Comparison ignores case and the edges of the name, like the files: a
 *   macOS volume does not tell `Maroc` from `maroc`, and neither should a
 *   gallery.
 *
 * Pure and DOM-free.
 */

/** How many numbers to try before giving up rather than looping. */
export const UNIQUE_DOC_NAME_LIMIT = 999;

/** The comparison key of a name: edges trimmed, case folded. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

const SUFFIX = /^(.*?)\s*\((\d+)\)$/;

/** `Maroc (2)` → `Maroc`; a name that IS only a suffix (`(2)`) stays whole. */
export function stripCloneSuffix(name: string): string {
  const trimmed = name.trim();
  const m = SUFFIX.exec(trimmed);
  if (!m) return trimmed;
  const base = m[1].trim();
  return base ? base : trimmed;
}

/**
 * `name` itself when nothing in `taken` carries it, else the first free
 * `base (2)`, `base (3)`… An empty name stays empty — the caller refuses it.
 */
export function uniqueDocName(name: string, taken: Iterable<string>): string {
  const wanted = name.trim();
  if (!wanted) return '';
  const used = new Set<string>();
  for (const t of taken) used.add(nameKey(t));
  if (!used.has(nameKey(wanted))) return wanted;
  const base = stripCloneSuffix(wanted);
  for (let n = 2; n <= UNIQUE_DOC_NAME_LIMIT; n += 1) {
    const candidate = `${base} (${n})`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
  throw new Error(`there are already ${UNIQUE_DOC_NAME_LIMIT} documents named like ${base}`);
}
