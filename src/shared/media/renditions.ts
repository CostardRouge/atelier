/**
 * THE FILES ONE CAPTURE IS MADE OF, and what each of them can give.
 *
 * A photograph is rarely one file. A Sony writes `DSC08463.ARW` beside
 * `DSC08463.HIF`; a DJI writes `DJI_0001.DNG` beside `DJI_0001.JPG`; a Winnow
 * adds its own 2048 px proxy over whichever of those it ingested. Until now
 * the suite could reach exactly two of them — the file in hand, and that
 * file's own original — so a capture whose sensor data lived in a SEPARATE
 * file was developed from an 8-bit proxy with no way up.
 *
 * This module is the vocabulary that replaces those two cases with a list.
 * Given what is known about a capture's files, it says which RENDITIONS exist,
 * what each one is FOR, how its pixels are reached, and which of them this
 * browser can actually draw. It decides nothing about fetching, decoding or
 * drawing: it is pure, DOM-free and does no I/O, so the callers that do stay
 * the ones that already know how (`sources/`, `raw/`, `render/`).
 *
 * The design, the measurements it rests on and what is still open are in
 * `docs/capture-renditions.md`; the material ladder it feeds is `raw.md`.
 */

import { isAtelierMade } from '../exif/software-mark';
import { isDecodableImage, isDrawableImage, isRawImage } from '../library/assets';

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * What a rendition is FOR — never what format it is in. Three roles answer
 * every camera in the house, which is what "transparent and systematic" has
 * to mean in code.
 */
export type RenditionRole =
  /** A source's editing rendition: fast, small, where a picture opens. */
  | 'proxy'
  /** What the camera wrote for people to look at — a JPEG, a HEIF, the render inside a RAW. */
  | 'delivered'
  /** The sensor's own data, for a decoder to develop. */
  | 'sensor';

/** How a rendition's pixels are got. */
export type RenditionReach =
  /** The browser draws the file as it is. */
  | 'file'
  /** A render the camera wrote INSIDE the file (`exif/raw-probe.ts`). */
  | 'embedded'
  /** LibRaw develops the sensor plane (`raw/raw-decoder.ts`). */
  | 'sensor'
  /**
   * A decoder of this suite's own, where the browser has none — a HEIF or a
   * JPEG XL in Chrome (`media/wasm-still.ts`) — or, for a format nothing here
   * reads, none at all: then the row is `blocked`, listed and never silently
   * dropped.
   */
  | 'decoder';

/** One file of a capture, as a caller knows it. */
export interface CaptureFile {
  /** The file's own name — the stable key, as everywhere else in the suite. */
  name: string;
  bytes?: number | null;
  /** True when the bytes are already in hand: no fetch, no permission prompt. */
  here?: boolean;
  /** Where to fetch it from when it is not here — an instance's `<host>/<id>`. */
  assetId?: string;
  /**
   * The pixels of the render INSIDE this file, where something has measured
   * them (`rawSizes`). Never guessed: a DJI's is 960 × 540 and a Sony's is
   * 7008 × 4672, and no rule predicts which.
   */
  render?: PixelSize | null;
  /** The sensor plane's own pixels, where they have been read. */
  sensor?: PixelSize | null;
  /** This file's own pixels, for one a browser draws directly. */
  pixels?: PixelSize | null;
  /**
   * The file's own `Software` tag, where its EXIF has been read. A file this
   * suite WROTE (`exif/software-mark.ts`) is an export that happens to sit
   * beside the capture — named after it, carrying a copy of its EXIF — and
   * is never one of its renditions (`docs/capture-renditions.md` §14.6).
   */
  software?: string | null;
}

export interface CaptureInput {
  /** The file the tool is holding right now. */
  open: CaptureFile;
  /** True when `open` is a source's editing rendition rather than a capture's own file. */
  openIsProxy?: boolean;
  /** The capture's other files: a folder's siblings, an instance's companion. */
  others?: readonly CaptureFile[];
  /**
   * Whether this browser draws a file of that name on its own. Injected
   * because the answer differs by browser and must be PROBED, never assumed:
   * Chrome 152 refuses HEIC, HEIF and TIFF where WebKit draws all three.
   */
  canDraw?: (name: string) => boolean;
}

export interface Rendition {
  /**
   * Stable and storable. `proxy`, else `<role>:<lowercased file name>` — the
   * name being what identifies a capture's file across devices, exactly as
   * `findMedia` and Winnow's own pairing already resolve one.
   */
  id: string;
  role: RenditionRole;
  reach: RenditionReach;
  /** The file these pixels come out of; empty for a source's proxy. */
  name: string;
  bytes: number | null;
  /** What this rendition delivers, where it has been MEASURED. Null is "nobody looked". */
  pixels: PixelSize | null;
  /** True when the bytes are in hand. */
  here: boolean;
  assetId: string | null;
  /** Why it cannot be used, in the words a person reads, or null. */
  blocked: string | null;
}

const ROLE_ORDER: Record<RenditionRole, number> = { proxy: 0, delivered: 1, sensor: 2 };

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function idFor(role: RenditionRole, name: string): string {
  return role === 'proxy' ? 'proxy' : `${role}:${name.toLowerCase()}`;
}

function area(size: PixelSize | null): number {
  return size ? size.width * size.height : 0;
}

/**
 * The rows one capture file contributes.
 *
 * A RAW contributes **two** — the render its camera wrote, and the sensor
 * plane — and that is the whole reason this is a list rather than a ladder:
 * measured on the maintainer's own bodies, those two differ by 8.4× on a DJI
 * (960 × 540 against 8064 × 4536) and by 0.5 % on a Sony A7C II (7008 × 4672
 * against 7040 × 4688). One row could not say that.
 */
function rowsFor(file: CaptureFile, canDraw: (name: string) => boolean): Rendition[] {
  const base = {
    name: file.name,
    bytes: file.bytes ?? null,
    here: file.here ?? false,
    assetId: file.assetId ?? null,
  };
  if (isRawImage(file.name)) {
    return [
      {
        ...base,
        id: idFor('delivered', file.name),
        role: 'delivered',
        reach: 'embedded',
        pixels: file.render ?? null,
        // A RAW with no embedded render at all is a real case (some bodies
        // write none); the caller finds out when it probes, and the row says
        // so rather than vanishing.
        blocked: file.render === null ? 'this file carries no render a browser can draw' : null,
      },
      {
        ...base,
        id: idFor('sensor', file.name),
        role: 'sensor',
        reach: 'sensor',
        pixels: file.sensor ?? null,
        blocked: null,
      },
    ];
  }
  const drawable = canDraw(file.name);
  const decodable = drawable || isDecodableImage(file.name);
  return [
    {
      ...base,
      id: idFor('delivered', file.name),
      role: 'delivered',
      reach: drawable ? 'file' : 'decoder',
      pixels: file.pixels ?? null,
      blocked: decodable ? null : `this browser does not draw ${extOf(file.name).toUpperCase() || 'this format'}`,
    },
  ];
}

/**
 * Which delivered rows are worth showing.
 *
 * A row this browser cannot draw — blocked, or reached only through a
 * decoder this suite ships — is dropped when the SAME capture already offers a
 * delivered row the browser draws for nothing. The measured case is a Sony
 * `.HIF`, a grid of six HEVC tiles Chrome reads only through libheif's wasm
 * (seconds and a whole-picture heap), beside an `.ARW` whose own embedded
 * render is the very same 7008 × 4672 photograph. Where nothing else is
 * drawable it STAYS — decodable, or blocked and saying why — because then it
 * is the only thing standing between the person and their picture.
 *
 * Pixels decide it where both are known; where the costly row's are not, the
 * free row wins — which is the honest reading of "nobody measured it".
 */
function pruneUndrawable(rows: readonly Rendition[]): Rendition[] {
  const available = rows.filter((r) => r.role === 'delivered' && !r.blocked && r.reach !== 'decoder');
  if (!available.length) return [...rows];
  const best = Math.max(...available.map((r) => area(r.pixels)));
  const known = available.some((r) => r.pixels);
  return rows.filter((r) => {
    // A row only a shipped decoder reads is weighed like a blocked one: it
    // works, but it costs a wasm decode for a picture the capture already
    // offers for nothing.
    if (r.role !== 'delivered' || !(r.blocked || r.reach === 'decoder')) return true;
    if (!r.pixels) return false;
    return known && area(r.pixels) > best;
  });
}

/**
 * Every rendition of one capture, ordered the way the pill reads it: the
 * proxy, then what the camera delivered, then the sensor.
 *
 * Within a role the smaller comes first, so the list climbs; a rendition
 * nobody has measured sits last of its role rather than claiming a place it
 * cannot justify.
 */
export function renditionsOf(input: CaptureInput): Rendition[] {
  const canDraw = input.canDraw ?? isDrawableImage;
  const rows: Rendition[] = [];
  if (input.openIsProxy) {
    rows.push({
      id: 'proxy',
      role: 'proxy',
      reach: 'file',
      name: input.open.name,
      bytes: input.open.bytes ?? null,
      pixels: input.open.pixels ?? null,
      here: input.open.here ?? true,
      assetId: input.open.assetId ?? null,
      blocked: null,
    });
  } else {
    rows.push(...rowsFor(input.open, canDraw));
  }
  const seen = new Set(rows.map((r) => r.id));
  for (const other of input.others ?? []) {
    // An export of ours beside the capture is not the camera's file. The OPEN
    // file is never dropped: it is what the person chose to work on.
    if (isAtelierMade(other.software)) continue;
    for (const row of rowsFor(other, canDraw)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return pruneUndrawable(rows).sort((a, b) => {
    const role = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (role !== 0) return role;
    const known = (a.pixels ? 0 : 1) - (b.pixels ? 0 : 1);
    if (known !== 0) return known;
    return area(a.pixels) - area(b.pixels);
  });
}

/** The rendition a stored id names, or null when this capture no longer has it. */
export function renditionById(rows: readonly Rendition[], id: string | null | undefined): Rendition | null {
  if (!id) return null;
  return rows.find((r) => r.id === id) ?? null;
}

/**
 * Where a picture OPENS: the cheapest rendition that can actually be drawn —
 * the proxy when there is one, else the smallest delivered row in hand.
 *
 * The maintainer's own rule (`docs/capture-renditions.md` §9): *"le proxy,
 * c'est vraiment pour la performance"* — where a picture opens, and never
 * where it is trapped.
 */
export function openingRendition(rows: readonly Rendition[]): Rendition | null {
  const usable = rows.filter((r) => !r.blocked && r.role !== 'sensor');
  const here = usable.filter((r) => r.here);
  return here[0] ?? usable[0] ?? null;
}

/** `7008 × 4672 · 2.7 MB`, or as much of it as was measured. */
export function renditionFacts(row: Rendition, formatBytes: (n: number) => string): string {
  const parts: string[] = [];
  if (row.pixels) parts.push(`${row.pixels.width} × ${row.pixels.height}`);
  if (row.bytes != null) parts.push(formatBytes(row.bytes));
  return parts.join(' · ');
}
