/**
 * WHEN and WITH WHAT a Winnow medium was taken, as an agent asks for it —
 * "my morning photos", "the golden-hour ones", "what I shot with the drone" —
 * read from the row Winnow already sends, with nothing fetched and no model.
 *
 * - The LOCAL hour: Winnow keeps the instant (`captured_at`) and, since its
 *   migration 0046, the UTC offset of the PLACE the frame was taken in
 *   (`capture_offset_min`, else the camera's own `exif_offset_min`). A frame
 *   whose EXIF carried no zone is stored as its wall clock pinned to UTC
 *   (`captured_at_source: 'exif-wall'`), so its UTC fields ARE the local
 *   hour. A zoned instant with no offset known says no hour rather than the
 *   server's.
 * - The LIGHT: the sun's elevation at that instant over the frame's own GPS
 *   (`lib/sun.ts`, NOAA's simplified solar position), read as night · blue
 *   hour · golden hour · day. A frame with no position or no
 *   true instant has no light.
 * - The GEAR: the body's kind from its EXIF model, by the same ordered
 *   matchers as Winnow's own shelf (`lib/gearSpec.ts` there, ported as is so
 *   both say "drone" of the same files).
 *
 * Pure and DOM-free.
 */

import { sunElevation } from '../../lib/sun';
import type { WinnowAssetRow } from './client';

type MomentRow = Pick<WinnowAssetRow, 'captured_at' | 'gps_lat' | 'gps_lon' | 'camera_model'> & {
  captured_at_source?: string | null;
  capture_offset_min?: number | null;
  exif_offset_min?: number | null;
  device?: string | null;
};

/** The place's offset east of UTC in minutes, as Winnow knows it, or null. */
function offsetOf(row: MomentRow): number | null {
  if (typeof row.capture_offset_min === 'number') return row.capture_offset_min;
  if (typeof row.exif_offset_min === 'number') return row.exif_offset_min;
  return null;
}

/**
 * The local wall clock as minutes since midnight, 0..1439, or null when it
 * cannot be told: no date, or an instant whose place's offset nobody knows.
 */
export function localMinutes(row: MomentRow): number | null {
  if (!row.captured_at) return null;
  const ms = Date.parse(row.captured_at);
  if (!Number.isFinite(ms)) return null;
  const off = offsetOf(row);
  // A wall clock pinned to UTC: its UTC fields are the hour on the camera.
  // So is a row from an instance older than the source column, whose
  // zone-less EXIF was read in the server's (UTC) zone (`exif-from-row.ts`).
  const local = row.captured_at_source === 'exif-wall' || row.captured_at_source == null ? ms : off === null ? null : ms + off * 60_000;
  if (local === null) return null;
  const d = new Date(local);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The true instant, or null when only a wall clock with no known offset is held. */
export function instantOf(row: MomentRow): number | null {
  if (!row.captured_at) return null;
  const ms = Date.parse(row.captured_at);
  if (!Number.isFinite(ms)) return null;
  if (row.captured_at_source === 'exif-wall' || row.captured_at_source == null) {
    const off = offsetOf(row);
    return off === null ? null : ms - off * 60_000;
  }
  return ms;
}

/** "07:42", or null. */
export function localClock(row: MomentRow): string | null {
  const m = localMinutes(row);
  if (m === null) return null;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Parts of the day by the clock — what a person means by "my morning photos". */
export const TIMES_OF_DAY = {
  morning: [5, 12],
  midday: [11, 14],
  afternoon: [12, 18],
  evening: [18, 22],
  night: [22, 5],
} as const satisfies Record<string, readonly [number, number]>;
export type TimeOfDay = keyof typeof TIMES_OF_DAY;

/** Whether `minutes` falls in [from, to) hours — wrapping past midnight when from > to. */
export function inHours(minutes: number, from: number, to: number): boolean {
  const a = from * 60;
  const b = to * 60;
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

export { sunElevation };

/** The light a frame was taken in, by the sun's elevation. */
export type Light = 'night' | 'blue' | 'golden' | 'day';

/** Photographers' bands: blue hour −6°..−4°, golden hour −4°..+6°. */
export function lightAt(elevation: number): Light {
  if (elevation < -6) return 'night';
  if (elevation < -4) return 'blue';
  if (elevation < 6) return 'golden';
  return 'day';
}

/** A row's light, or null with no position or no true instant. */
export function lightOf(row: MomentRow): Light | null {
  if (row.gps_lat == null || row.gps_lon == null) return null;
  const at = instantOf(row);
  return at === null ? null : lightAt(sunElevation(at, row.gps_lat, row.gps_lon));
}

/** The body's kind, Winnow's shelf vocabulary narrowed to what a person asks by. */
export type GearKind = 'drone' | 'phone' | 'action' | 'camera';

// Winnow's `lib/gearSpec.ts` matchers, first hit wins: phones before drones
// ("iPhone 12 mini" is not a DJI Mini), every interchangeable or compact body
// a "camera".
const GEAR: readonly [GearKind, RegExp][] = [
  ['phone', /iphone|ipad|ipod|pixel|galaxy|\bsm-[a-z]\d|oneplus|xiaomi|redmi|\bpoco\b|huawei|honor|\boppo\b|\bvivo\b|nothing phone|motorola|\bmoto [ge]\b|nexus/],
  ['drone', /\bdji\b|mavic|phantom \d|inspire \d|avata|\bfc\d{3,4}\b|autel|\bevo (ii|lite|nano)|skydio|parrot|anafi/],
  ['action', /gopro|hero\s?\d|osmo (action|pocket)|insta360|\bone (rs|x\d)\b|virb/],
];

/** The kind of body behind a row's EXIF model, or null when it names none. */
export function gearOf(row: MomentRow): GearKind | null {
  const name = [row.device, row.camera_model].filter(Boolean).join(' ').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!name) return null;
  return GEAR.find(([, re]) => re.test(name))?.[0] ?? 'camera';
}
