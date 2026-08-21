/**
 * What we let the muxer say about our colours — and, more often, what we stop
 * it from saying.
 *
 * mp4-muxer writes an MP4 `colr` nclx box from the `colorSpace` on the
 * metadata the `VideoEncoder` hands back, which is how our exports come to be
 * correctly tagged bt709 without any code of ours asking for it (see
 * docs/memory/media-pipeline.md). It builds that box with plain map lookups
 * and NO bounds check: an unmapped value becomes `u16(undefined)`, which
 * writes **0**. For matrix coefficients 0 means Identity/RGB — not "unknown"
 * but an active, wrong claim that players will act on.
 *
 * A wrong tag is worse than no tag: an untagged file is merely guessed at,
 * consistently, by each player, whereas a file whose container contradicts its
 * bitstream renders differently in QuickTime, Premiere and the browser. So the
 * rule here is all-or-nothing — either the colour space is fully specified and
 * every field is encodable, or we strip it and let the file carry no `colr`.
 *
 * The partial case is the subtle one and the real reason this exists: a
 * `colorSpace` of `{ primaries: 'bt709' }` alone still writes matrix=0, and a
 * missing `fullRange` still writes 0 (limited) — a guess, and guessing range
 * wrong is a visible contrast error.
 *
 * Pure and DOM-free.
 */

/** Exactly the strings mp4-muxer 5.2.2 can encode. Keep in step with it. */
const PRIMARIES = new Set(['bt709', 'bt470bg', 'smpte170m']);
const TRANSFER = new Set(['bt709', 'smpte170m', 'iec61966-2-1']);
const MATRIX = new Set(['rgb', 'bt709', 'bt470bg', 'smpte170m']);

/**
 * True when every field is present and within what the muxer can write.
 * Deliberately strict: a partially specified colour space is a mis-tag
 * waiting to happen, not a partial improvement.
 */
export function isEncodableColorSpace(cs: VideoColorSpaceInit | null | undefined): boolean {
  if (!cs) return false;
  return (
    typeof cs.primaries === 'string' &&
    PRIMARIES.has(cs.primaries) &&
    typeof cs.transfer === 'string' &&
    TRANSFER.has(cs.transfer) &&
    typeof cs.matrix === 'string' &&
    MATRIX.has(cs.matrix) &&
    typeof cs.fullRange === 'boolean'
  );
}

/**
 * Metadata that is safe to hand to `muxer.addVideoChunk`.
 *
 * Returns the argument untouched in the normal case — a fully specified,
 * encodable colour space, which is what Chrome reports for a canvas-sourced
 * frame. Otherwise returns a COPY with `colorSpace` removed, so no `colr` box
 * is written at all; every other field of `decoderConfig` (`codec`,
 * `codedWidth`, `codedHeight`, `description`) survives.
 *
 * Never mutates its argument: the object belongs to the browser, and mp4-muxer
 * `Object.assign`s it into state it keeps until `finalize()`.
 */
export function safeChunkMetadata<T extends { decoderConfig?: VideoDecoderConfig }>(
  meta: T | undefined,
): T | undefined {
  const config = meta?.decoderConfig;
  if (!meta || !config || config.colorSpace === undefined) return meta;
  if (isEncodableColorSpace(config.colorSpace)) return meta;

  // Copy first, then drop — `config` is the browser's object, not ours.
  const stripped: VideoDecoderConfig = { ...config };
  delete stripped.colorSpace;
  return { ...meta, decoderConfig: stripped };
}
