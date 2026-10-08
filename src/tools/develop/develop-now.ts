/**
 * What the workbench develops the open picture WITH, and what a write of its
 * draft carries — the two answers that must agree on where the base comes
 * from. Pure and DOM-free; `PictureWorkbench` calls it once per render.
 *
 * Three cases:
 *
 * - the DRAFT is on the sensor → it is the whole answer;
 * - the DOCUMENT is on the sensor and the draft is not (SETTLING): an undo
 *   landing before the draft is re-seeded, the echo of a first write, or the
 *   author stepping DOWN to a file — the stage keeps the stored base for
 *   those frames rather than flash the render;
 * - the picture FOLLOWS the roll's sensor (`roll-choice.ts`) with no base of
 *   its own → the roll's base, the gain metered for the visit.
 *
 * Only the third makes a write carry a base the draft does not hold. Settling
 * never does: the draft is not on the sensor because the author took it off,
 * or will be re-seeded the next commit, and putting the stored base back into
 * the write is what kept a picture stepped down to its render on the sensor
 * for good — the write landed equal to the document, nothing re-seeded, and
 * the stage stayed on the stored base (2026-10-08, his A7C II report).
 */
import { isRawDevelop, type DevelopSettings } from '../../shared/develop/develop';
import { openingBaseCurve } from '../../shared/develop/base-curve';
import { PROFILE_PENDING, type RawProfile } from '../../shared/raw/dng-color';

/** The material a picture on the roll's sensor takes from the roll. */
export type RollBase = Pick<DevelopSettings, 'base' | 'rawGain' | 'rawProfile' | 'baseCurve'>;

export interface DevelopNowInput {
  /** The editor's draft. */
  draft: DevelopSettings;
  /** The picture's develop as the document holds it. */
  stored: DevelopSettings | null | undefined;
  /** The roll's choice hands this picture its sensor (`rollChoiceFor`, a sensor in reach, not let go). */
  followsSensor: boolean;
  /** The gain the stage metered for the visit while following; null before. */
  followGain: number | null;
  /** The camera profile resolved with it; null before. */
  followProfile: RawProfile | null;
}

export interface DevelopNow {
  /** What the stage, the stack and the menu develop from. */
  now: DevelopSettings;
  /** The document is on the sensor and the draft is not — for a commit or for good. */
  settling: boolean;
  /** The roll's base a write carries; null unless the picture follows the roll's sensor. */
  rollBase: RollBase | null;
}

export function developNowOf({ draft, stored, followsSensor, followGain, followProfile }: DevelopNowInput): DevelopNow {
  if (isRawDevelop(draft)) return { now: draft, settling: false, rollBase: null };
  const settling = isRawDevelop(stored) && stored != null;
  const rollBase: RollBase | null = followsSensor
    ? {
        base: 'gain',
        rawGain: followGain,
        // Resolved by the stage's first decode (C4), held for the visit.
        rawProfile: followProfile ?? PROFILE_PENDING,
        baseCurve: openingBaseCurve(draft.baseCurve),
      }
    : null;
  if (settling && stored) {
    return {
      now: { ...draft, base: stored.base, rawGain: stored.rawGain, rawProfile: stored.rawProfile ?? null, baseCurve: stored.baseCurve ?? null },
      settling,
      rollBase,
    };
  }
  // On the roll's sensor the picture opens on the opening curve, as the
  // export does (`openingBaseCurve`), until it is given its own.
  return { now: rollBase ? { ...draft, ...rollBase } : draft, settling: false, rollBase };
}

/** The develop a write hands the document: the draft, with the roll's base where it follows it. */
export function developToWrite(value: DevelopSettings | null, rollBase: RollBase | null): DevelopSettings | null {
  return rollBase && value && !isRawDevelop(value) ? { ...value, ...rollBase } : value;
}
