/**
 * A RAW's PROFILE tone curve (`ProfileToneCurve`, C7 of
 * `docs/camera-profiles.md`), read from a megabyte of the file's head — no
 * decoder — and handed over as the points the `profile` base curve stores
 * (`profileCurvePoints`). Held for the session per file, like the
 * calibration (`raw/calibration.ts`): the stage asks to know whether to
 * OFFER the choice, the export asks to fill a picture that chose it before
 * its curve was read.
 */

import type { DngProfile } from '../exif/dng-profile';
import { probeRaw, RAW_PROBE_BYTES } from '../exif/raw-probe';
import { dcpProfile } from '../raw/profile-vault';
import { profileCurvePoints } from './base-curve';
import type { CurvePoint } from './curves';

const held = new Map<string, Promise<DngProfile | null>>();

const keyOf = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

/** The colour profile a RAW's head carries (`dng-profile.ts`), read once per file; null for none. */
export function readHeadProfile(file: File): Promise<DngProfile | null> {
  const key = keyOf(file);
  let known = held.get(key);
  if (!known) {
    known = file
      .slice(0, Math.min(RAW_PROBE_BYTES, file.size))
      .arrayBuffer()
      .then((head) => probeRaw(head)?.profile ?? null)
      .catch(() => null);
    held.set(key, known);
  }
  return known;
}

/** The profile's curve as stored points, or null when the file carries none (or none we can read). */
export async function readProfileCurve(file: File): Promise<CurvePoint[] | null> {
  return profileCurvePoints((await readHeadProfile(file))?.toneCurve);
}

/**
 * The curve a `profile` base curve takes for a picture: a LOADED profile's
 * (C8) where the picture chose one — null when this device's vault does not
 * hold it — else the file's own.
 */
export async function profileCurveFor(file: File, dcpHash: string | null | undefined): Promise<CurvePoint[] | null> {
  if (dcpHash) return profileCurvePoints((await dcpProfile(dcpHash))?.toneCurve);
  return readProfileCurve(file);
}
