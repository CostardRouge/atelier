/**
 * An HDR picture LOOKED AT, on this screen, before the file is written.
 *
 * No browser grants an HDR canvas without a flag (`hdr-display.ts`), so the
 * stage stays the SDR base — but every current browser DRAWS an Ultra HDR
 * JPEG handed to an `<img>` with its gain map, on a display with headroom
 * (Chrome, Edge and Safari on his Mac and his iPhone, both P3 HDR screens).
 * So the preview is the FILE: the picture as delivered, rendered twice at
 * stage size through the very passes the export runs — its own cube, and its
 * cube developed the roll's stops darker (`deliveredWith`) — cut, bordered
 * and wrapped by the same `encodeUltraHdr`, then shown as an image rather
 * than drawn. What it says is measured the same way the export's claim is:
 * the headroom the map holds and how far it read back.
 *
 * What it is NOT: the file itself (the export decodes the picture at its own
 * density and sharpens for the target), nor a lift on an SDR screen — there
 * both views look the same, and the sheet says so rather than pretending.
 */

import { pictureAspectRatio } from '../develop/crop-aspect';
import { drawDelivered } from '../develop/border-paint';
import type { RollBorder } from '../develop/border-layout';
import { deliveredLayout, type PictureSize } from '../develop/roll-export';
import { DEFAULT_FRAMING, type Framing } from '../media/framing';
import { encodeUltraHdr } from './ultra-hdr-export';
import { readUltraHdr } from './ultra-hdr';

/** The preview's long edge: the stage's own budget is near this, and a bigger JPEG buys nothing on screen. */
export const HDR_PREVIEW_EDGE = 2048;
const PREVIEW_QUALITY = 0.92;

export interface HdrPreview {
  /** The Ultra HDR JPEG — or the plain base when no map could be made — as an object URL. */
  url: string;
  /** The SDR base alone, as an object URL; the same bytes as `url` when the file carries no map. */
  baseUrl: string;
  width: number;
  height: number;
  /** True when `url` IS an Ultra HDR file that read back within tolerance. */
  ultra: boolean;
  /** The lift the map holds, in stops. */
  headroom: number;
  /** The read-back's worst stray, in stops, when it was checked. */
  checked: number | null;
  /** Why there is no map, when there is none. */
  reason: string | null;
  /** Revoke both URLs. */
  release(): void;
}

export interface HdrPreviewInput {
  /** The picture as delivered, graded whole — `delivered()`. */
  sdr: CanvasImageSource;
  /** The same picture `stops` darker — `deliveredWith(darker cube)` — or null when there is no sensor to reach into. */
  dark: CanvasImageSource | null;
  /** The graded picture's own size. */
  source: PictureSize;
  framing: Framing | null;
  aspect: string;
  border: RollBorder | null;
  stops: number;
  longEdge?: number;
}

function framed(input: HdrPreviewInput, image: CanvasImageSource, longEdge: number): HTMLCanvasElement {
  const ratio = pictureAspectRatio(input.aspect, input.source.width, input.source.height);
  const { out, layout } = deliveredLayout(input.source, ratio, input.framing, input.border, longEdge);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, out.w);
  canvas.height = Math.max(1, out.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not draw the HDR preview.');
  ctx.imageSmoothingQuality = 'high';
  drawDelivered(ctx, image, input.source.width, input.source.height, input.framing ?? DEFAULT_FRAMING, layout, input.border);
  return canvas;
}

/**
 * The preview, drawn SYNCHRONOUSLY from both renders before anything is
 * awaited — a caller hands over the grader's own canvas, which its next
 * render overwrites.
 */
export async function previewUltraHdr(input: HdrPreviewInput): Promise<HdrPreview> {
  const longEdge = input.longEdge ?? HDR_PREVIEW_EDGE;
  const sdr = framed(input, input.sdr, longEdge);
  const dark = input.dark ? framed(input, input.dark, longEdge) : null;
  const size = { width: sdr.width, height: sdr.height };
  if (!dark) {
    const blob = await new Promise<Blob | null>((resolve) => sdr.toBlob(resolve, 'image/jpeg', PREVIEW_QUALITY));
    if (!blob) throw new Error('The browser could not encode the preview.');
    const url = URL.createObjectURL(blob);
    return { url, baseUrl: url, ...size, ultra: false, headroom: 0, checked: null, reason: 'not developed on its RAW: nothing above white to reach into', release: () => URL.revokeObjectURL(url) };
  }
  const result = await encodeUltraHdr(sdr, dark, input.stops, PREVIEW_QUALITY);
  const url = URL.createObjectURL(result.blob);
  let baseUrl = url;
  if (result.ultra) {
    const parts = readUltraHdr(new Uint8Array(await result.blob.arrayBuffer()));
    if (parts) baseUrl = URL.createObjectURL(new Blob([parts.primary as BlobPart], { type: 'image/jpeg' }));
  }
  return {
    url,
    baseUrl,
    ...size,
    ultra: result.ultra,
    headroom: result.headroom,
    checked: result.checked,
    reason: result.reason,
    release: () => {
      URL.revokeObjectURL(url);
      if (baseUrl !== url) URL.revokeObjectURL(baseUrl);
    },
  };
}
