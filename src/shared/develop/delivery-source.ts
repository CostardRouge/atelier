/**
 * WHICH PIXELS a still is delivered from, for every host that delivers one
 * (2026-09-20, O2 of `docs/develop-originals.md`).
 *
 * The Develop tool has answered this since D9; Trips' Export tab and the
 * Studio's stills delivered from the proxy whatever it held, which the
 * measured case says is not good enough: a landscape proxy cropped to 4:5 is
 * already upscaled ×1.25 at a 1920 export. Rather than a second copy of the
 * decision, the three hosts share this one seam — the arithmetic is
 * `roll-export.ts`'s, the session's held originals are
 * `sources/original-cache.ts`'s, and what is new here is only the fetching
 * order and the RAW head.
 *
 * The rules it carries, all of them the roll's:
 *
 * - an original is fetched only where the mode asks and the frame needs it;
 * - a fetched original is HELD for the session and never persisted
 *   (decision 3), so a second export of the same picture pays no fetch;
 * - a RAW is reached only through the render inside it, whose size is read
 *   from a megabyte of the file's head and cached — never assumed, because
 *   a DJI's is 960 × 540 (`develop-originals.md` §7.4, corrected).
 */

import { isRawImage } from '../library/assets';
import type { Framing } from '../media/framing';
import { knownIdentity, mediaOrigin, type MediaOrigin } from '../projects/media-identity';
import {
  heldOriginal,
  heldRawRender,
  holdOriginal,
  holdRawRender,
} from '../sources/original-cache';
import { RAW_PROBE_BYTES, rawSizes, rawSizesFrom } from '../exif/raw-probe';
import { fixedFrameDelivery, type DeliverySummary, type OriginalInfo, type PictureSize } from './roll-export';
import type { RollOriginals } from './roll-types';
import { measurePicture } from './roll-render';

export function originalOf(origin: MediaOrigin | null, render: PictureSize | null = null): OriginalInfo | null {
  if (!origin || origin.fidelity !== 'proxy') return null;
  return {
    width: origin.width,
    height: origin.height,
    name: origin.name ?? null,
    bytes: origin.bytes ?? null,
    render,
  };
}

/** True when the file in hand is a proxy whose original is a RAW. */
export function isProxyOverRaw(origin: MediaOrigin | null): boolean {
  return origin?.fidelity === 'proxy' && !!origin.name && isRawImage(origin.name);
}

/**
 * How big the render inside a proxy's RAW original really is, read from that
 * file's HEAD and remembered for the session (`original-cache.ts`).
 *
 * `head` comes back only when this call is what fetched it, so a caller that
 * also needs the original's EXIF pays for one read and not two.
 */
export async function rawRenderOf(
  origin: MediaOrigin,
  key: string | null,
): Promise<{ render: PictureSize | null; head: Uint8Array | null }> {
  return rawRenderFrom(origin.fetchOriginalHead ?? null, key);
}

/**
 * The same, for ANY RAW the session can reach by a head fetch — a capture's
 * companion (`MediaOrigin.companion.fetchHead`) as much as a proxy's own
 * original. `key` is the asset id the answer is remembered under.
 */
export async function rawRenderFrom(
  fetchHead: ((bytes: number) => Promise<ArrayBuffer>) | null,
  key: string | null,
): Promise<{ render: PictureSize | null; head: Uint8Array | null }> {
  const held = key ? heldOriginal(key) : null;
  if (held) {
    const sizes = await rawSizes(held);
    if (key) holdRawRender(key, sizes.render);
    return { render: sizes.render, head: null };
  }
  if (key) {
    const known = heldRawRender(key);
    if (known !== undefined) return { render: known, head: null };
  }
  if (!fetchHead) return { render: null, head: null };
  try {
    const buffer = await fetchHead(RAW_PROBE_BYTES);
    const render = rawSizesFrom(buffer).render;
    if (key) holdRawRender(key, render);
    return { render, head: new Uint8Array(buffer) };
  } catch {
    if (key) holdRawRender(key, null);
    return { render: null, head: null };
  }
}

/** What a host got back: the bytes to render, and the sentence about them. */
export interface DeliverySource {
  /** The file to draw from — the one handed in, or the original that was fetched. */
  file: File;
  /** What it will deliver into the frame asked for, and why those pixels. */
  summary: DeliverySummary | null;
  /** True when an original was pulled for this delivery. */
  fetched: boolean;
}

/**
 * Decide, and fetch if the decision says so, for ONE picture delivered into a
 * FIXED frame. `out` is the frame the host will really write — Trips' deck
 * size, a Studio variant — and `framing` how the picture is cropped into it.
 *
 * A file the source never vouched for, or one whose measurement fails, comes
 * back exactly as it went in with a null summary: knowing nothing is not a
 * reason to refuse a delivery that used to work.
 */
export async function deliveryFor(
  file: File,
  framing: Framing | null,
  out: { w: number; h: number },
  mode: RollOriginals,
  onProgress?: (line: string) => void,
): Promise<DeliverySource> {
  const origin = mediaOrigin(file);
  const size = await measurePicture(file);
  if (!size) return { file, summary: null, fetched: false };
  const key = knownIdentity(file)?.assetId ?? null;
  const render = origin && isProxyOverRaw(origin) ? (await rawRenderOf(origin, key)).render : null;
  const summary = fixedFrameDelivery(size, origin?.fidelity === 'proxy', originalOf(origin, render), framing, out, mode);
  if (summary.from !== 'original' || !origin?.fetchOriginal) return { file, summary, fetched: false };
  const held = key ? heldOriginal(key) : null;
  if (held) return { file: held, summary, fetched: false };
  try {
    onProgress?.('Fetching the original…');
    const fetched = await origin.fetchOriginal();
    if (key) holdOriginal(key, fetched);
    return { file: fetched, summary, fetched: true };
  } catch {
    // A fetch that fails costs the extra pixels, never the delivery.
    return { file, summary: { ...summary, from: 'file' }, fetched: false };
  }
}
