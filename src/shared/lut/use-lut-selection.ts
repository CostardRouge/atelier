/**
 * LUT picking state + logic, shared by any tool that grades through a `.cube`.
 *
 * Extracted from LUT Studio so the Telemetry Overlay tool can offer the very
 * same look picker (built-in groups + custom upload) without duplicating the
 * fetch/parse/error bookkeeping. Pairs with the presentational `LutPicker`.
 */

import { useState } from 'react';
import { parseCube, type CubeLut } from '../lib/cube-parser';
import { CUBE_ACCEPT, pickFile } from '../sources/file-sources';
import { BUILTIN_LUTS } from './builtin-luts';

export interface LutSelection {
  /** The parsed LUT to grade through, or null for the original image. */
  lut: CubeLut | null;
  /** Current `<select>` value: 'none' | builtin id | 'custom'. */
  selected: string;
  /** File name of the uploaded LUT, if any (shown as the 'custom' option). */
  customName: string | null;
  /** Raw `.cube` text of the uploaded LUT — what a project document persists. */
  customText: string | null;
  cubeError: string | null;
  /** True while a built-in LUT is being fetched/parsed. */
  busy: boolean;
  /** LUT strength as a multiplier: 0 = original, 1 = full LUT, 3 = 300%. */
  intensity: number;
  setIntensity: (value: number) => void;
  applySelection: (value: string) => Promise<void>;
  uploadCube: () => Promise<void>;
  /** Restore a saved selection (builtin id, or a custom LUT from stored text). */
  restore: (saved: {
    selected: string;
    customName: string | null;
    customText: string | null;
    intensity: number;
  }) => Promise<void>;
}

export function useLutSelection(): LutSelection {
  const [lut, setLut] = useState<CubeLut | null>(null);
  const [selected, setSelected] = useState('none');
  const [customLut, setCustomLut] = useState<CubeLut | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [customText, setCustomText] = useState<string | null>(null);
  const [cubeError, setCubeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // LUT strength, 0..3 (100% = the LUT as authored). Persists across LUT swaps.
  const [intensity, setIntensity] = useState(1);

  async function applySelection(value: string) {
    setSelected(value);
    setCubeError(null);
    if (value === 'none') {
      setLut(null);
      return;
    }
    if (value === 'custom') {
      setLut(customLut);
      return;
    }
    const entry = BUILTIN_LUTS.find((l) => l.id === value);
    if (!entry) return;
    setBusy(true);
    try {
      const res = await fetch(entry.url);
      const parsed = parseCube(await res.text());
      if (!parsed) {
        setCubeError(`Could not parse ${entry.name}.`);
        setLut(null);
      } else {
        setLut(parsed);
      }
    } catch {
      setCubeError(`Could not load ${entry.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadCube() {
    const file = await pickFile(CUBE_ACCEPT);
    if (!file) return;
    setCubeError(null);
    const text = await file.text();
    const parsed = parseCube(text);
    if (!parsed) {
      setCubeError(
        `${file.name} isn't a supported 3D .cube LUT (1D LUTs aren't supported).`,
      );
      return;
    }
    setCustomLut(parsed);
    setCustomName(file.name);
    setCustomText(text);
    setLut(parsed);
    setSelected('custom');
  }

  async function restore(saved: {
    selected: string;
    customName: string | null;
    customText: string | null;
    intensity: number;
  }) {
    setIntensity(saved.intensity);
    if (saved.customText) {
      const parsed = parseCube(saved.customText);
      if (parsed) {
        setCustomLut(parsed);
        setCustomName(saved.customName);
        setCustomText(saved.customText);
        if (saved.selected === 'custom') {
          setLut(parsed);
          setSelected('custom');
          return;
        }
      }
    }
    if (saved.selected !== 'custom') {
      await applySelection(saved.selected);
    }
  }

  return {
    lut,
    selected,
    customName,
    customText,
    cubeError,
    busy,
    intensity,
    setIntensity,
    applySelection,
    uploadCube,
    restore,
  };
}
