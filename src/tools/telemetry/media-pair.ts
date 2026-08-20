/**
 * The telemetry tool's view of an asset: a DJI video with its telemetry SRT
 * sibling (`DJI_0001.MP4` ↔ `DJI_0001.SRT`). Pairing itself lives in the
 * shared library (`shared/library/assets.ts`) — this is just the projected
 * shape the tool's components render.
 */
export interface MediaPair {
  /** Stable identity for React keys and selection (lowercased base name). */
  id: string;
  /** Filename without extension, e.g. `DJI_0001`. */
  baseName: string;
  /** The video file, or null if not yet provided. */
  video: File | null;
  /** The telemetry file, or null if not yet provided. */
  srt: File | null;
  /** True when a manually-attached video's base name differs from baseName. */
  videoNameMismatch?: boolean;
  /** True when a manually-attached SRT's base name differs from baseName. */
  srtNameMismatch?: boolean;
}
