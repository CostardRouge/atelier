import { useMemo } from 'react';
import { deviceClass } from '../../shared/lib/device-class';
import { DEFAULT_PERF, sanitizePerf, workersFor, type PerfPrefs } from '../../shared/mosaic/perf';
import { localPref, useLocalPref } from '../../shared/ui/local-pref';

/** The Performance panel's choices, this device's (`perf.ts`), read by every screen at once. */
export const MOSAIC_PERF_PREF = localPref<PerfPrefs>(
  'atelier.mosaic.perf',
  (raw) => {
    try {
      return sanitizePerf(raw ? JSON.parse(raw) : null);
    } catch {
      return DEFAULT_PERF;
    }
  },
  (value) => JSON.stringify(value),
);

export function useMosaicPerf(): [PerfPrefs, (patch: Partial<PerfPrefs>) => void] {
  const [perf, set] = useLocalPref(MOSAIC_PERF_PREF, DEFAULT_PERF);
  const update = useMemo(() => (patch: Partial<PerfPrefs>) => set(sanitizePerf({ ...MOSAIC_PERF_PREF.get(), ...patch })), [set]);
  return [perf, update];
}

/** How many workers this device spawns under `perf` — the panel's auto read on this machine. */
export function workersHere(perf: PerfPrefs): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return workersFor(perf, cores, deviceClass() === 'constrained');
}

/** Whether motion is reduced here: the system's say unless the panel forces it. */
export function motionReduced(perf: PerfPrefs): boolean {
  if (perf.motion === 'reduced') return true;
  if (perf.motion === 'full') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
