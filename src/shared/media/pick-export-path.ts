/**
 * Decide how to export a given clip's overlay.
 *
 *  - `webcodecs` — the browser can decode the source via WebCodecs (fast,
 *    faster-than-realtime).
 *  - `seek` — WebCodecs can't decode it, but a `<video>` element can play it,
 *    so the codec-agnostic seek path works (slower).
 *  - `none` — neither works (no encoder, or an undecodable + unplayable codec).
 */

import { isEncodeSupported } from './webcodecs-export';

export type ExportPath = 'webcodecs' | 'seek' | 'none';

export interface ExportDecision {
  path: ExportPath;
  /** True when the blocking codec is HEVC/H.265 (for a precise message). */
  isHevc: boolean;
}

export interface ExportHint {
  /** Container codec string from `probeContainer`, e.g. `hvc1.1.6.L150`. */
  codec?: string;
  width?: number;
  height?: number;
  /** Whether a `<video>` element can play this clip (i.e. it didn't error). */
  videoPlayable: boolean;
}

function isHevcCodec(codec: string | undefined): boolean {
  if (!codec) return false;
  return /^(hvc1|hev1|hvc|hev)/i.test(codec.split('.')[0]);
}

export async function decideExportPath(hint: ExportHint): Promise<ExportDecision> {
  const isHevc = isHevcCodec(hint.codec);

  // Encoding is required for both real paths.
  if (!isEncodeSupported()) return { path: 'none', isHevc };

  const canTestDecode = typeof VideoDecoder !== 'undefined';

  if (hint.codec && canTestDecode) {
    const support = await VideoDecoder.isConfigSupported({
      codec: hint.codec,
      codedWidth: hint.width ?? 1920,
      codedHeight: hint.height ?? 1080,
    }).catch(() => ({ supported: false }) as VideoDecoderSupport);
    if (support.supported) return { path: 'webcodecs', isHevc };
    return { path: hint.videoPlayable ? 'seek' : 'none', isHevc };
  }

  // Codec unknown: try WebCodecs optimistically (the pipeline self-checks and
  // the caller falls back to seek on a decode error). If we can't even test
  // decode, fall back to whatever can play.
  if (canTestDecode) return { path: 'webcodecs', isHevc };
  return { path: hint.videoPlayable ? 'seek' : 'none', isHevc };
}
