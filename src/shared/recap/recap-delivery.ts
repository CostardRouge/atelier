/**
 * How a recap's VIDEO is delivered (his ask, 2026-11-05: «net, clean,
 * impeccable», qualities to choose from, «VBR 2 passes»): a quality (a
 * target bitrate), a frame rate, one or two passes, and which file a Winnow
 * clip is painted from. Stored on the document, so an agent sets it and a
 * recap exports the same way twice.
 *
 * **Two passes, honestly.** WebCodecs has no two-pass rate control. What a
 * two-pass VBR buys — the bits spent where the picture needs them, the file
 * landing on its size — is had here by measuring: pass 1 encodes every frame
 * at one constant quantizer and counts its bytes; pass 2 encodes at the one
 * quantizer that lands the whole film on the target (`media/two-pass.ts`).
 * That needs the encoder's `quantizer` mode, which not every browser and
 * platform has; without it the film is one VBR pass at the same target.
 *
 * Pure and DOM-free.
 */

import { framedDraw, type Frame } from './recap-frame';

export type Quality = 'standard' | 'high' | 'max';
export const QUALITIES: readonly Quality[] = ['standard', 'high', 'max'];
export const QUALITY_LABEL: Record<Quality, string> = { standard: 'Standard', high: 'High', max: 'Maximum' };

/** Megabits per second for a 1080 × 1920 film at 30 fps; other sizes and rates scale from it. */
export const QUALITY_MBPS: Record<Quality, number> = { standard: 8, high: 16, max: 28 };

export type DeliveryFps = 30 | 60;
export type MediaSource = 'proxy' | 'original';

export interface RecapDelivery {
  quality: Quality;
  fps: DeliveryFps;
  passes: 1 | 2;
  /**
   * What the film is painted from: the light copies the stage uses (Winnow's
   * proxies, the kept prints), or the ORIGINALS — every clip, the looping
   * background first, and every picture a print would have to blow up
   * (`needsOriginal`) — fetched for that export only.
   */
  media: MediaSource;
  /**
   * An original this browser cannot play (an iPhone HEVC `.MOV`) converted by
   * the suite's ffmpeg.wasm — only what the film shows (`recap-transcode.ts`).
   * His ask, switched on here: the core (~31 MB, unpkg) is fetched the first
   * time, as the legal notice says.
   */
  convert: boolean;
}

export const DEFAULT_DELIVERY: RecapDelivery = { quality: 'high', fps: 30, passes: 1, media: 'proxy', convert: false };

export function readDelivery(raw: unknown): RecapDelivery {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    quality: QUALITIES.includes(r.quality as Quality) ? (r.quality as Quality) : DEFAULT_DELIVERY.quality,
    fps: r.fps === 60 ? 60 : 30,
    passes: r.passes === 2 ? 2 : 1,
    // `clips` was its first name, the morning it was made.
    media: r.media === 'original' || r.clips === 'original' ? 'original' : 'proxy',
    convert: r.convert === true,
  };
}

/**
 * The target in bits per second for a `w × h` film at `fps`: the quality's
 * figure scaled by the pixels, and by the frame rate to the power ¾ — twice
 * the frames do not need twice the bits, each differs less from the last.
 */
export function deliveryBitrate(d: Pick<RecapDelivery, 'quality' | 'fps'>, w: number, h: number): number {
  const pixels = (w * h) / (1080 * 1920);
  return Math.round(QUALITY_MBPS[d.quality] * 1e6 * pixels * Math.pow(d.fps / 30, 0.75));
}

/** The file's rough size in bytes: the video at its target and an audio track at ~160 kb/s. */
export function deliverySize(d: Pick<RecapDelivery, 'quality' | 'fps'>, w: number, h: number, seconds: number, sound: boolean): number {
  return Math.round(((deliveryBitrate(d, w, h) + (sound ? 160_000 : 0)) * seconds) / 8);
}

/**
 * True when a still `srcW × srcH` would be BLOWN UP filling `box` under
 * `frame` — the page's pixels more than the source's by over 5 % — so its
 * original is worth fetching. A month's small cells never are; a full-page
 * picture from a landscape print, or a zoomed one, is.
 */
export function needsOriginal(srcW: number, srcH: number, box: { x: number; y: number; w: number; h: number }, frame?: Frame): boolean {
  if (!(srcW > 0) || !(srcH > 0)) return false;
  const d = framedDraw(srcW, srcH, box, frame);
  return d.w / d.win.sw > 1.05;
}

/** «12 MB», «850 kB» — a size as a person reads it. */
export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${bytes >= 1e7 ? Math.round(bytes / 1e6) : (bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

/**
 * True when an original decoded at `w × h` gives a page more than the print
 * it would replace (`print`). A RAW's original read through its camera render
 * is the case: a DJI DNG's 960 × 540 render must never stand in for its
 * 2048 px print (`sensor-outside-develop.md`).
 */
export function beatsPrint(w: number, h: number, print: { width: number; height: number } | null): boolean {
  if (!(w > 0) || !(h > 0)) return false;
  if (!print) return true;
  return w * h > print.width * print.height;
}
