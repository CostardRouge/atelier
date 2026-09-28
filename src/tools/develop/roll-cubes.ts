import { isDefaultDevelop, type DevelopSettings } from '../../shared/develop/develop';
import type { RollGrade } from '../../shared/develop/roll-types';
import type { CubeLut } from '../../shared/lib/cube-parser';
import type { Interpolation } from '../../shared/lut/interpolate';
import { composeLutStack, type LutLayer } from '../../shared/lut/lut-stack';
import { restoreLayers } from '../../shared/lut/restore-grade';
import { gradeKey } from '../../shared/lut/saved-grade';

export interface RollCubes {
  /** The cube one picture leaves through: its look over its develop. */
  cubeFor: (grade: RollGrade | null, develop: DevelopSettings | null) => Promise<CubeLut | null>;
  /**
   * The looks of `grade` this device cannot resolve (`LutLayer.missing`),
   * named with their reason — what the run says about a file that left
   * WITHOUT them, rather than delivering it quietly ungraded.
   */
  missingIn: (grade: RollGrade | null) => Promise<{ name: string; reason: string }[]>;
}

/**
 * The cube one picture of a roll leaves through: ITS look over ITS develop.
 *
 * The export's half of roll v5. The live stack answers for the open picture
 * only — it follows the filmstrip, and a run of forty pictures must not read
 * whichever look happens to be open when it reaches each one — so a run bakes
 * from each picture's STORED look, which the stack writes through. Unlike
 * `use-grade-cubes.ts` it WAITS for a look to be fetched: that hook may answer
 * "as shot" for a beat on screen, a delivered file may not.
 *
 * One resolver per run: each distinct look is fetched once, however many
 * pictures wear it.
 */
export function rollCubes(interpolation: Interpolation): RollCubes {
  const resolved = new Map<string, Promise<readonly LutLayer[]>>();
  const layersOf = (grade: RollGrade): Promise<readonly LutLayer[]> => {
    const key = gradeKey(grade);
    let layers = resolved.get(key);
    if (!layers) {
      layers = restoreLayers(grade.layers).then((r) => r.layers);
      resolved.set(key, layers);
    }
    return layers;
  };
  return {
    cubeFor: async (grade, develop) => {
      const correction = isDefaultDevelop(develop) ? null : develop;
      if (!grade || grade.layers.length === 0) {
        return composeLutStack([], grade?.output ?? 'none', interpolation, correction);
      }
      return composeLutStack(await layersOf(grade), grade.output, interpolation, correction);
    },
    missingIn: async (grade) => {
      if (!grade || grade.layers.length === 0) return [];
      // Only a look that would have graded: one switched off or at 0 %
      // changes nothing in the file whether it resolves or not.
      return (await layersOf(grade)).flatMap((l) =>
        l.missing && l.enabled && l.intensity > 0 ? [{ name: l.name, reason: l.missing }] : [],
      );
    },
  };
}
