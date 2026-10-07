/**
 * A RAW's PROFILE tone curve (`ProfileToneCurve`, C7 of
 * `docs/camera-profiles.md`), read from a megabyte of the file's head — no
 * decoder — and handed over as the points the `profile` base curve stores
 * (`profileCurvePoints`). Held for the session per file, like the
 * calibration (`raw/calibration.ts`): the stage asks to know whether to
 * OFFER the choice, the export asks to fill a picture that chose it before
 * its curve was read.
 */

import { probeRaw, RAW_PROBE_BYTES } from '../exif/raw-probe';
import { profileCurvePoints } from './base-curve';
import type { CurvePoint } from './curves';

const held = new Map<string, CurvePoint[] | null>();

const keyOf = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

/** The profile's curve as stored points, or null when the file carries none (or none we can read). */
export async function readProfileCurve(file: File): Promise<CurvePoint[] | null> {
  const key = keyOf(file);
  const known = held.get(key);
  if (known !== undefined) return known;
  let out: CurvePoint[] | null = null;
  try {
    const probe = probeRaw(await file.slice(0, Math.min(RAW_PROBE_BYTES, file.size)).arrayBuffer());
    out = profileCurvePoints(probe?.profile?.toneCurve);
  } catch {
    out = null;
  }
  held.set(key, out);
  return out;
}
