/**
 * Baking grades NOBODY is editing.
 *
 * `useLutStack` is one stack bound to one document: it holds parsed layers,
 * defers its bake for the strength slider, and answers `composeWith(develop)`
 * for the picture in hand. That is exactly right for the grade under the
 * author's fingers and useless for the others — and a deck whose pictures
 * each carry their own look has others, by construction (`post-grade.ts`).
 *
 * So this hook is the read-only half: hand it the stored grades a screen has
 * to DRAW, and it resolves their layers once and bakes one cube per (grade,
 * develop) pair. No editing, no deferral, no write-back — a caller that wants
 * those wants the stack.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { isDefaultDevelop, type DevelopSettings } from '../develop/develop';
import type { CubeLut } from '../lib/cube-parser';
import { composeLutStack, type LutLayer } from './lut-stack';
import { restoreLayers } from './restore-grade';
import { gradeKey, type SavedGrade } from './saved-grade';
import { useLutInterpolation } from './use-lut-interpolation';

/**
 * The cube one stored grade bakes to with one picture's own correction.
 * `null` is "as shot" — nothing to apply, or the grade's looks have not been
 * fetched yet, which is the same transient the bound stack has always had on
 * restore: the picture draws ungraded for a beat and then lands.
 */
export type GradeCubes = (grade: SavedGrade, develop: DevelopSettings | null) => CubeLut | null;

/**
 * How many resolved grades are kept. A trip's deck asks for a handful; the
 * cap is what stops a long session of switching pieces holding every look it
 * ever drew. Anything no longer asked for is dropped when the cap is crossed.
 */
const MAX_RESOLVED = 12;

/** How many baked cubes are kept — the same bound `composeWith` uses. */
const MAX_CUBES = 32;

export function useGradeCubes(grades: readonly SavedGrade[]): GradeCubes {
  const { interpolation } = useLutInterpolation();

  // The distinct grades asked for, by key. Built from the array the caller
  // hands us on every render — cheap, because `gradeKey` reads identities and
  // never a cube's text.
  const wanted = useMemo(() => {
    const map = new Map<string, SavedGrade>();
    for (const grade of grades) map.set(gradeKey(grade), grade);
    return map;
  }, [grades]);

  const [resolved, setResolved] = useState<ReadonlyMap<string, readonly LutLayer[]>>(
    () => new Map(),
  );

  /**
   * Keys being fetched right now. Tracked rather than cancelled on cleanup,
   * because `wanted` is rebuilt whenever the host's document changes: a run
   * that restarted on every re-render would never land while the author kept
   * typing, and the picture would stay ungraded for as long as they did.
   */
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const [key, grade] of wanted) {
      if (resolved.has(key) || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      void restoreLayers(grade.layers).then(({ layers }) => {
        inFlight.current.delete(key);
        if (!mounted.current) return;
        setResolved((prev) => {
          const next = new Map(prev).set(key, layers);
          if (next.size > MAX_RESOLVED) {
            for (const stale of [...next.keys()]) if (!wanted.has(stale)) next.delete(stale);
          }
          return next;
        });
      });
    }
  }, [wanted, resolved]);

  // One cube per (grade, develop) pair. The cache lives with the resolution
  // and the interpolation mode it was baked from — a new one of either makes
  // a new function and an empty cache, so a stale cube cannot survive a
  // preference change (the rule `interpolate.ts` states: the bake and the
  // shader must agree, or preview and export diverge).
  return useMemo(() => {
    const cubes = new Map<string, CubeLut | null>();
    return (grade: SavedGrade, develop: DevelopSettings | null): CubeLut | null => {
      const layers = resolved.get(gradeKey(grade));
      if (!layers) return null;
      const correction = isDefaultDevelop(develop) ? null : develop;
      const key = `${gradeKey(grade)}#${correction ? JSON.stringify(correction) : ''}`;
      let cube = cubes.get(key);
      if (cube === undefined) {
        if (cubes.size >= MAX_CUBES) cubes.clear();
        cube = composeLutStack(layers, grade.output, interpolation, correction);
        cubes.set(key, cube);
      }
      return cube;
    };
  }, [resolved, interpolation]);
}
