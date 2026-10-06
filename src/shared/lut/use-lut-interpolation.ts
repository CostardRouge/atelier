/**
 * The lattice lookup used when reading a 3D LUT — trilinear or tetrahedral.
 *
 * This is a RENDER preference, not creative project data: it does not change
 * what the grade is, only how faithfully the LUT's sparse lattice is read
 * between its points. So it lives in `localStorage` (per the project's rule
 * that localStorage holds UI prefs only) rather than in `ProjectDoc`, which
 * also spares a document migration. See interpolate.ts for what actually
 * differs, and docs/memory/media-pipeline.md for the measured numbers.
 *
 * Tetrahedral is the default, matching Resolve, Nuke and Baselight. That does
 * change rendered pixels versus the old behaviour — deliberately, because the
 * old behaviour let a channel-asymmetric look tint neutral greys.
 */

import { useCallback, useEffect } from 'react';
import { localPref, useLocalPref } from '../ui/local-pref';
import type { Interpolation } from './interpolate';
import { setDefaultLutInterpolation } from './lut-gl';

const KEY = 'atelier.lut.interpolation';

/** One value for every reader — the look panel, the stage, the settings page (`local-pref.ts`). */
export const lutInterpolationPref = localPref<Interpolation>(
  KEY,
  (raw) => (raw === 'trilinear' ? 'trilinear' : 'tetrahedral'),
  (mode) => mode,
);

export interface LutInterpolationPref {
  interpolation: Interpolation;
  setInterpolation: (mode: Interpolation) => void;
}

export function useLutInterpolation(): LutInterpolationPref {
  const [interpolation, write] = useLocalPref(lutInterpolationPref, 'tetrahedral');

  // Renderers built later (every export job builds its own) read the module
  // default, so it has to track the preference — synchronously enough that an
  // export started right after a toggle uses the mode the user just picked.
  useEffect(() => {
    setDefaultLutInterpolation(interpolation);
  }, [interpolation]);

  const setInterpolation = useCallback(
    (mode: Interpolation) => {
      setDefaultLutInterpolation(mode);
      write(mode);
    },
    [write],
  );

  return { interpolation, setInterpolation };
}
