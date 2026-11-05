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

export type Quality = 'standard' | 'high' | 'max';
export const QUALITIES: readonly Quality[] = ['standard', 'high', 'max'];
export const QUALITY_LABEL: Record<Quality, string> = { standard: 'Standard', high: 'High', max: 'Maximum' };

/** Megabits per second for a 1080 × 1920 film at 30 fps; other sizes and rates scale from it. */
export const QUALITY_MBPS: Record<Quality, number> = { standard: 8, high: 16, max: 28 };

export type DeliveryFps = 30 | 60;
export type ClipSource = 'proxy' | 'original';

export interface RecapDelivery {
  quality: Quality;
  fps: DeliveryFps;
  passes: 1 | 2;
  /** A Winnow clip painted from its proxy (light, fast) or its original (sharp, fetched for the export). */
  clips: ClipSource;
}

export const DEFAULT_DELIVERY: RecapDelivery = { quality: 'high', fps: 30, passes: 1, clips: 'proxy' };

export function readDelivery(raw: unknown): RecapDelivery {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    quality: QUALITIES.includes(r.quality as Quality) ? (r.quality as Quality) : DEFAULT_DELIVERY.quality,
    fps: r.fps === 60 ? 60 : 30,
    passes: r.passes === 2 ? 2 : 1,
    clips: r.clips === 'original' ? 'original' : 'proxy',
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

/** «12 MB», «850 kB» — a size as a person reads it. */
export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${bytes >= 1e7 ? Math.round(bytes / 1e6) : (bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}
