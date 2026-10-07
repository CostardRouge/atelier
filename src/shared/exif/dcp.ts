/**
 * A DCP — Adobe's DNG Camera Profile file (DNG spec 1.4, ch. 6, «Camera
 * Profile file format»): a TIFF in all but its magic, `IIRC` (or `MMCR`)
 * where a TIFF says `II*`, whose ONE IFD holds exactly the profile tags a
 * DNG's IFD0 may carry — calibrations, forward matrices, hue/sat map, look
 * table, tone curve, the name and the embed policy. So it is read by the very
 * reader a DNG's own profile goes through (`readDngProfile`), whole: a DCP is
 * a few hundred kilobytes and is always in hand, so nothing is `unread`.
 *
 * Atelier ships none and fetches none (C8 of `docs/camera-profiles.md`): a
 * DCP is a file the person loads, from his own install, into the vault
 * (`raw/profile-vault.ts`).
 *
 * Pure and DOM-free.
 */

import { readDngProfile, type DngProfile } from './dng-profile';
import { parseIfd } from './exif-parser';

/** What a loaded `.dcp` says, read. */
export interface DcpFile {
  profile: DngProfile;
  /** `ProfileName`, else the file's own name without its extension. */
  name: string;
}

/** Whether these bytes open like a DCP: `IIRC` little-endian, `MMCR` big-endian. */
export function isDcp(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const b = new Uint8Array(buffer, 0, 4);
  return (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x52 && b[3] === 0x43) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x43 && b[3] === 0x52);
}

/**
 * A DCP read whole, or null when the bytes are not one or carry no colour
 * matrix — a profile with nothing to convert with is no profile.
 */
export function readDcp(buffer: ArrayBuffer, fileName = ''): DcpFile | null {
  if (!isDcp(buffer)) return null;
  try {
    const view = new DataView(buffer);
    const little = view.getUint8(0) === 0x49;
    const ifd = view.getUint32(4, little);
    if (ifd < 8 || ifd >= buffer.byteLength) return null;
    const profile = readDngProfile(view, parseIfd(view, 0, ifd, little), little);
    if (!profile || !profile.calibrations.some((c) => c.colorMatrix)) return null;
    const name = profile.name.trim() || fileName.replace(/\.dcp$/i, '').trim() || 'Camera profile';
    return { profile, name: name.slice(0, 80) };
  } catch {
    return null;
  }
}
