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
  /**
   * The capture's OTHER image files — the ones that did not take the `image`
   * slot: the `.DNG` beside a DJI's `.JPG`, the `.HIF` beside a Sony's `.ARW`.
   * Kept, since 2026-09-21, because they are the capture's renditions
   * (`media/renditions.ts`) and a folder is the only place a card-only
   * workflow can find them. In listing order; a tool that wants ONE picture
   * keeps reading `image` and never these.
   */
  siblings?: File[];
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
/**
 * Formats a browser can normally decode and draw — `heic`/`heif`/`hif` being
 * the honest exception the list has always carried: only WebKit decodes them,
 * and a source's proxy is what every other browser draws instead. `hif` is
 * Sony's and Canon's spelling of the same thing (an A7C II shoots `.HIF`
 * beside its `.ARW`), so leaving it out classified those stills as junk and
 * dropped them at the library's door.
 */
const ENCODED_IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'heic', 'heif', 'hif', 'webp', 'tif', 'tiff', 'avif', 'gif',
];
/** Camera RAW — handles are kept even though the browser can't decode them. */
const RAW_EXTENSIONS = [
  'raf', 'arw', 'cr2', 'cr3', 'nef', 'dng', 'orf', 'rw2', 'raw', 'srw', 'pef',
];
const IMAGE_EXTENSIONS = [...ENCODED_IMAGE_EXTENSIONS, ...RAW_EXTENSIONS];

/**
 * The narrower list inside `ENCODED_IMAGE_EXTENSIONS`: what a browser really
 * draws ON ITS OWN, in every browser. HEIF (`.heic`/`.heif`/`.hif`) and TIFF
 * are pictures WebKit alone decodes, so they are recognised as images and
 * never counted on to DRAW one.
 *
 * `bmp` is here and not above on purpose: nobody shoots one, but an original
 * may be one, and this list is also what says an export can deliver from a
 * file rather than from the render (`roll-export.ts`).
 */
const DRAWABLE_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'];

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

/**
 * True for a camera RAW. Exported because "can this be decoded and drawn?" is
 * a question the library, the metadata reader and the studio all ask, and one
 * list of extensions must answer it for all three.
 */
export function isRawImage(name: string): boolean {
  return RAW_EXTENSIONS.includes(splitName(name).ext);
}

/** Human label for an image file: `RAW`, `JPEG`, or the bare extension. */
export function imageTypeLabel(name: string): string {
  const { ext } = splitName(name);
  if (isRawImage(name)) return 'RAW';
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
  return ext ? ext.toUpperCase() : 'image';
}

/** True where any browser draws this file without a decoder of our own. */
export function isDrawableImage(name: string): boolean {
  return DRAWABLE_IMAGE_EXTENSIONS.includes(splitName(name).ext);
}

/**
 * Which file of one capture fills the image slot, when several could.
 *
 * Not "the one that is not a RAW": a Sony shoots `.ARW` + `.HIF`, and the HEIF
 * is the half MOST browsers cannot draw at all, while the RAW draws through
 * the render its camera wrote inside it (`exif/raw-probe.ts`). Ranking rather
 * than yielding is also what makes the answer independent of the order the
 * directory listed the two files in.
 */
function imageRank(name: string): number {
  if (isDrawableImage(name)) return 2;
  if (isRawImage(name)) return 1;
  return 0;
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

/** The type a capture's file is known by on screen: its extension upper-cased, `JPEG` for both spellings. */
export function captureFileType(name: string): string {
  const { ext } = splitName(name);
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
  return ext ? ext.toUpperCase() : 'file';
}

/**
 * The types of the capture's OTHER image files — the `DNG` beside a DJI's
 * JPEG, the `ARW` beside a Sony's JPEG — once each, in the order they came.
 *
 * `buildAssets` files a RAW that shares its base name with a JPEG as a
 * SIBLING of the JPEG (the half every tool draws), and the Library listed
 * the JPEG alone: a RAW added beside its twin changed nothing on screen and
 * read as ignored (2026-09-23). This is what the row says so it cannot.
 */
export function siblingTypes(parts: AssetParts): string[] {
  const out: string[] = [];
  for (const file of parts.siblings ?? []) {
    const type = captureFileType(file.name);
    if (!out.includes(type)) out.push(type);
  }
  return out;
}

/** True when one of the capture's other files is a camera RAW. */
export function hasRawSibling(parts: AssetParts): boolean {
  return (parts.siblings ?? []).some((f) => isRawImage(f.name));
}

/** Every file of an asset, the siblings included — what leaves when it does. */
export function assetFiles(parts: AssetParts): File[] {
  return [parts.video, parts.srt, parts.image, ...(parts.siblings ?? [])].filter((f): f is File => !!f);
}

function sizeOf(parts: AssetParts): number {
  return assetFiles(parts).reduce((n, f) => n + f.size, 0);
}

/**
 * Group raw files into logical assets, keyed by base name (case-insensitive).
 *
 * - Recognised videos, SRTs and images fill an asset's parts; anything else
 *   (`.LRF` proxies, `.THM`, hidden dotfiles) is ignored.
 * - First file to claim a slot wins, so the result is deterministic. An image
 *   that loses the slot is kept in `siblings` rather than dropped.
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
    else if (part === 'image') {
      // First to claim the slot wins among equals — but a file the browser can
      // really DRAW always outranks one it cannot. A `IMG_8801.RAF` +
      // `IMG_8801.JPG` pair is one photo and the JPEG is the half every tool
      // wants to show, grade and export; a `DSC00123.ARW` + `DSC00123.HIF`
      // pair is one photo too, and there the RAW is the better half, since
      // only WebKit draws a HEIF while the RAW draws through its own render.
      const current = group.parts.image;
      if (!current) {
        group.parts.image = file;
      } else if (imageRank(name) > imageRank(current.name)) {
        group.parts.image = file;
        (group.parts.siblings ??= []).push(current);
      } else {
        (group.parts.siblings ??= []).push(file);
      }
    }
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
