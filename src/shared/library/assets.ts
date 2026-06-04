/**
 * The asset library model — pure, dependency-free, DOM-free.
 *
 * A single drop/folder can mix videos, their telemetry sidecars, and photos.
 * `buildAssets` groups raw files into logical *assets* keyed by base name
 * (generalising the telemetry `pairFiles`), so a `DJI_0001.MP4` + `DJI_0001.SRT`
 * become one `video+telemetry` asset, and `IMG_8801.RAF` + `IMG_8801.JPG` one
 * `photo` asset. Each tool then reads the parts (and kinds) it cares about.
 *
 * This layer holds only `File` handles — lazy references to bytes on disk.
 * Nothing is read, decoded, or uploaded here.
 */

/** What a tool can do with an asset, derived from which parts it holds. */
export type AssetKind =
  | 'video+telemetry'
  | 'video'
  | 'telemetry'
  | 'photo'
  | 'other';

/** The concrete files that make up one asset (any combination). */
export interface AssetParts {
  video?: File;
  srt?: File;
  image?: File;
}

export interface Asset {
  /** Stable identity (lowercased base name) — React keys, selection. */
  id: string;
  /** Base name without extension, e.g. `DJI_0001`, for display. */
  baseName: string;
  parts: AssetParts;
  kind: AssetKind;
  /** Sum of the parts' sizes, in bytes. */
  size: number;
}

type PartKind = 'video' | 'srt' | 'image' | 'other';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm'];
const IMAGE_EXTENSIONS = [
  // Common encoded formats…
  'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff', 'avif', 'gif',
  // …and camera RAW (handles are kept even if the browser can't decode them).
  'raf', 'arw', 'cr2', 'cr3', 'nef', 'dng', 'orf', 'rw2', 'raw', 'srw', 'pef',
];

/** Split a filename into `{ base, ext }`; ext is lowercased, no leading dot. */
function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

/** The base name (without extension) of a file, for display/comparison. */
export function fileBaseName(name: string): string {
  return splitName(name).base;
}

/** Classify a file by extension into the part slot it fills. */
export function classifyPart(name: string): PartKind {
  const { ext } = splitName(name);
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (ext === 'srt') return 'srt';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return 'other';
}

/** Derive an asset's kind from which parts it holds. */
function kindOf(parts: AssetParts): AssetKind {
  if (parts.video && parts.srt) return 'video+telemetry';
  if (parts.video) return 'video';
  if (parts.image) return 'photo';
  if (parts.srt) return 'telemetry';
  return 'other';
}

function sizeOf(parts: AssetParts): number {
  return (
    (parts.video?.size ?? 0) +
    (parts.srt?.size ?? 0) +
    (parts.image?.size ?? 0)
  );
}

/**
 * Group raw files into logical assets, keyed by base name (case-insensitive).
 *
 * - Recognised videos, SRTs and images fill an asset's parts; anything else
 *   (`.LRF` proxies, `.THM`, hidden dotfiles) is ignored.
 * - First file to claim a slot wins, so the result is deterministic.
 * - Sorted by base name for stable ordering.
 */
export function buildAssets(files: File[]): Asset[] {
  const groups = new Map<string, { baseName: string; parts: AssetParts }>();

  for (const file of files) {
    const name = file.name;
    if (name.startsWith('.')) continue; // hidden / junk

    const part = classifyPart(name);
    if (part === 'other') continue;

    const base = fileBaseName(name);
    const key = base.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { baseName: base, parts: {} };
      groups.set(key, group);
    }

    if (part === 'video' && !group.parts.video) group.parts.video = file;
    else if (part === 'srt' && !group.parts.srt) group.parts.srt = file;
    else if (part === 'image' && !group.parts.image) group.parts.image = file;
  }

  const assets: Asset[] = [];
  for (const [key, group] of groups) {
    assets.push({
      id: key,
      baseName: group.baseName,
      parts: group.parts,
      kind: kindOf(group.parts),
      size: sizeOf(group.parts),
    });
  }

  assets.sort((a, b) => a.baseName.localeCompare(b.baseName));
  return assets;
}

/** A stable identity for a `File`, used to dedupe across repeated drops. */
export function fileIdentity(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}`;
}
