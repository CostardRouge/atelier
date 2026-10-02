/**
 * Which subject points count as KNOWN on the open picture — what tells a point
 * the author just TAPPED (whose region blinks, `use-subject-masks.ts`) from one
 * merely segmented again. Pure, tested.
 *
 * The trap it holds (2026-09-30, his report "the first subject pick does not
 * do the flashing animation"): the model's view of the picture is only made
 * once a subject HAS a point (`segmenting`), so the very first tap arrives
 * while there is no view yet. The mask effect returns early — nothing to show
 * the model — and if this record advanced in the same commit, the point was
 * already known by the time the view arrived, and its region never blinked.
 * So while there is no view, a point tapped on the same picture is NOT
 * recorded: it stays new until the model can answer it.
 *
 * A layer that ARRIVES with its points — on a picture just opened, by an undo
 * that brings it back, by a paste — records them all, view or not: nobody
 * tapped them here, and re-opening a picture blinks nothing. Only a point
 * GAINED by a layer the record already held can be a tap.
 *
 * The trap the first version of that rule fell into (2026-10-02, his report
 * "every subject mask flashes as soon as I land on a picture"): it told a
 * picture just opened by a `previous` of null, but the workbench is mounted
 * per picture and its record starts as THIS picture with nothing in it — so
 * every layer of a picture just opened was recorded with no points, and each
 * point blinked as a fresh tap the moment the model's view arrived.
 */
export type KnownPoints = ReadonlyMap<string, ReadonlySet<string>>;

export interface SubjectEntry {
  /** The layer's id. */
  id: string;
  /** Its points, as the hook keys them. */
  keys: readonly string[];
}

export function knownSubjectPoints(
  entries: readonly SubjectEntry[],
  /** The record as it stood, or null when it was made for another picture. */
  previous: KnownPoints | null,
  /** Whether the model has a view of the picture to answer a tap with. */
  viewReady: boolean,
): Map<string, Set<string>> {
  const points = new Map<string, Set<string>>();
  for (const { id, keys } of entries) {
    const before = previous?.get(id);
    const held = !viewReady && before ? keys.filter((k) => before.has(k)) : keys;
    // Every subject layer is recorded, pointless ones included: that is what
    // makes the FIRST tap on a fresh layer a new point.
    points.set(id, new Set(held));
  }
  return points;
}
