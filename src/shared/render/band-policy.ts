/**
 * Whether a big frame is drawn in BANDS on this device — a render preference.
 *
 * Bands exist for a phone's GPU: the graph's two float16 targets at the size
 * of the frame are 16 bytes a pixel — three quarters of a gigabyte at 48
 * megapixels — which an iPhone's tab is never given (`band-plan.ts`). A
 * computer has that memory, and its loupe drew a 7008 px picture whole for
 * the ten days before bands existed. Since they do, the maintainer's Mac has
 * drawn that very loupe STRIPED — one band's rows in another's place, the
 * rest a row smeared down — while the same chains are exact on SwiftShader
 * and the page's own probe (`bandsDrawRightHere`) says yes on that GPU
 * (2026-10-02, `render-core.md`, «Bands»). The cause is still unmeasured,
 * and his ruling was the plain one: bands buy a computer nothing.
 *
 * So the rule is the DEVICE's class, with a preference over it either way:
 * `auto` bands a constrained device only (where the memory is the whole
 * point, and where the loupe is capped anyway); `bands` and `whole` say so
 * for every frame, on any device — how a computer that is short of GPU
 * memory asks for the slice, and how a phone is told to stop. A browser
 * preference (`localStorage`), like the lattice interpolation and the device
 * class, never a document's.
 *
 * Pure; the graph reads it through `getBandPreference` (`graph.ts`).
 */

import type { DeviceClass } from '../lib/device-class';

export type BandPreference = 'auto' | 'whole' | 'bands';

export const BAND_PREFERENCE_KEY = 'atelier.render.bands';

/** A stored value read back — anything unknown is `auto`. */
export function readBandPreference(stored: string | null | undefined): BandPreference {
  return stored === 'whole' || stored === 'bands' ? stored : 'auto';
}

/** Whether a frame big enough to band is cut, under `preference` on a device of `device` class. */
export function bandsWanted(preference: BandPreference, device: DeviceClass): boolean {
  if (preference === 'bands') return true;
  if (preference === 'whole') return false;
  return device === 'constrained';
}

/** What `auto` means on a device of this class — for the row that says it. */
export function autoBandsMean(device: DeviceClass): 'whole' | 'bands' {
  return bandsWanted('auto', device) ? 'bands' : 'whole';
}
