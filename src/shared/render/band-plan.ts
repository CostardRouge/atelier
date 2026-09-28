/**
 * How a big render is cut into BANDS — pure, tested.
 *
 * A graph of N passes over a W×H frame holds two float16 ping-pong targets of
 * the whole frame: 16 bytes a pixel, so a 48-megapixel still export costs
 * ~770 MB of GPU memory in targets alone (`MEMORY.md`, the open item of
 * 2026-09-20), which is what a phone cannot give. Rendered in full-width
 * bands, the targets only ever hold one band — plus the rows the passes after
 * it will READ around that band.
 *
 * That last part is the whole difficulty, and it is answered per pass: each
 * says, for a span of rows it must write, which rows of its INPUT it reads
 * (`RowNeed`). A colour pass reads its own rows; a blur reads its radius
 * more; a warp reads wherever its map sends the band. Walking the chain
 * BACKWARDS from the band the canvas wants gives every intermediate's region;
 * the first pass reads the source, which stays whole. A pass that cannot say
 * (a node that reads its whole input, like the halation) returns null, and the
 * graph then renders the frame whole, as it always did.
 *
 * Rows are TEXTURE rows — GL's, counted from the bottom of the frame in the
 * graph's own convention — because that is what a viewport and a target are
 * measured in; a warp converts to image rows inside its own need, exactly as
 * its shader does with `imageUv`.
 */

export interface RowSpan {
  /** First row, inclusive. */
  y0: number;
  /** Last row, exclusive. */
  y1: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * The rows of its input a pass reads to write `out`, or null where it cannot
 * say. `flipY` is the flip the pass's own draw uses — 1 only for the first
 * pass reading a bitmap — so a pass that thinks in image rows can convert.
 */
export type RowNeed = (out: RowSpan, frame: FrameSize, flipY: number) => RowSpan | null;

/** A pass that reads `rows` rows above and below the one it writes — 0 for a colour pass. */
export function nearRows(rows: number | ((frame: FrameSize) => number)): RowNeed {
  return (out, frame) => {
    const r = typeof rows === 'function' ? rows(frame) : rows;
    return { y0: out.y0 - r, y1: out.y1 + r };
  };
}

/** Every pointwise pass shares this one. */
export const OWN_ROWS: RowNeed = nearRows(0);

/**
 * A WARP's rows: where its map sends the band's points. `sourceUv` is the
 * shader's own arithmetic in JavaScript — from the texture coordinate a
 * fragment is drawn at to every texture coordinate it samples (one per
 * channel), both as the shader sees them. The band is sampled on a grid
 * (its two edges and its interior, a column every 16 px), which is exact for a
 * keystone — a projective map sends a rectangle's extremes to its corners —
 * and close for the radial maps, whose error the slack covers.
 */
export function warpRows(sourceUv: (u: number, v: number, flipY: number) => readonly (readonly [number, number])[]): RowNeed {
  return (out, frame, flipY) => {
    const { width, height } = frame;
    let lo = Infinity;
    let hi = -Infinity;
    // A column every 16 px and a row every 8, within bounds: measured on a
    // stack of three warps, a 33-column grid missed the extreme by enough
    // rows to leave a seam at a band edge.
    const columns = Math.max(33, Math.min(257, Math.ceil(width / 16) + 1));
    const rows = Math.max(2, Math.min(33, Math.ceil((out.y1 - out.y0) / 8) + 1));
    for (let j = 0; j < rows; j += 1) {
      const y = out.y0 + 0.5 + ((out.y1 - out.y0 - 1) * j) / (rows - 1);
      const v = y / height;
      for (let i = 0; i < columns; i += 1) {
        const u = (0.5 + ((width - 1) * i) / (columns - 1)) / width;
        for (const [, sv] of sourceUv(u, v, flipY)) {
          // A point off the picture is not sampled at all (the shaders draw
          // it empty), so it asks for no row.
          if (!(sv >= 0 && sv <= 1)) continue;
          lo = Math.min(lo, sv * height);
          hi = Math.max(hi, sv * height);
        }
      }
    }
    if (!Number.isFinite(lo)) return { y0: out.y0, y1: out.y0 };
    // Slack on top of the grid (2 % of the band, four rows at least): a map
    // can still bulge between two sampled points, and a missing row is a seam.
    const slack = Math.max(4, (out.y1 - out.y0) * 0.02);
    return { y0: lo - slack, y1: hi + slack };
  };
}

export interface Band {
  /** The rows of the OUTPUT this band draws. */
  out: RowSpan;
  /**
   * The rows each pass must WRITE for it, index for index with the passes:
   * the last is `out`; the first pass reads the source and needs no region
   * below it.
   */
  regions: RowSpan[];
}

export interface BandPlan {
  bands: Band[];
  /** The tallest region any intermediate target must hold — its allocated height. */
  targetRows: number;
}

/** Rows kept around every region for the bilinear read at its edge. */
export const BAND_PAD = 2;

/**
 * The plan for `needs` over `frame` in bands of `bandRows`, or null where any
 * pass after the first cannot say what it reads, or where banding would buy
 * nothing (a region reaching the whole frame everywhere is no saving, only
 * more draws).
 */
export function planBands(frame: FrameSize, bandRows: number, needs: readonly (RowNeed | null | undefined)[]): BandPlan | null {
  const { height } = frame;
  const n = needs.length;
  if (n < 2 || !(bandRows > 0) || bandRows >= height) return null;
  for (let i = 1; i < n; i += 1) if (!needs[i]) return null;
  const clamp = (span: RowSpan): RowSpan => ({
    y0: Math.max(0, Math.floor(span.y0) - BAND_PAD),
    y1: Math.min(height, Math.ceil(span.y1) + BAND_PAD),
  });
  const bands: Band[] = [];
  let targetRows = 0;
  for (let y = 0; y < height; y += bandRows) {
    const out = { y0: y, y1: Math.min(height, y + bandRows) };
    const regions: RowSpan[] = new Array(n);
    regions[n - 1] = out;
    // The pass after i reads rows of what i writes: walk back from the canvas.
    for (let i = n - 1; i >= 1; i -= 1) {
      // The last pass writes the canvas, the others a target — both with no
      // flip: only the first pass reads a (possibly flipped) source.
      const read = needs[i]!(regions[i], frame, 0);
      if (!read) return null;
      const region = clamp(read);
      regions[i - 1] = region.y1 > region.y0 ? region : { y0: region.y0, y1: region.y0 };
      targetRows = Math.max(targetRows, regions[i - 1].y1 - regions[i - 1].y0);
    }
    bands.push({ out, regions });
  }
  if (targetRows >= height) return null;
  return { bands, targetRows };
}

/**
 * A pass's fragment made band-aware: every `texture(u_src, uv)` goes through
 * `_bandUv`, which takes a FRAME coordinate to the coordinate of the band
 * target that holds it — `u_srcBand` = (the band's first row / H, its
 * allocated rows / H − 1, the frame's edge rows to clamp to, lo and hi).
 * All four at zero is the identity, to the bit: `(y − 0) / (1 + 0)`, no
 * clamp — which is what a program sees when nothing sets them, so a whole
 * render and a pass's own sub-render are exactly what they were.
 *
 * The clamp stands in for CLAMP_TO_EDGE at the FRAME's edges: a band target
 * is taller than its region, and a read past the frame's last row must land
 * on that row, not on whatever the target holds below it.
 *
 * Null where the shader does not declare `uniform sampler2D u_src;` the way
 * every pass here does — the graph then never bands it.
 */
export function bandFragment(fragment: string): string | null {
  const decl = 'uniform sampler2D u_src;';
  const at = fragment.indexOf(decl);
  if (at < 0) return null;
  const helper = `
uniform vec4 u_srcBand;
vec2 _bandUv(vec2 uv) {
  float y = u_srcBand.w > u_srcBand.z ? clamp(uv.y, u_srcBand.z, u_srcBand.w) : uv.y;
  return vec2(uv.x, (y - u_srcBand.x) / (1.0 + u_srcBand.y));
}`;
  let out = fragment.slice(0, at + decl.length) + helper + fragment.slice(at + decl.length);
  const open = 'texture(u_src,';
  let from = out.indexOf(helper) + helper.length;
  for (;;) {
    const hit = out.indexOf(open, from);
    if (hit < 0) break;
    // The argument runs to the parenthesis that closes `texture(`.
    let depth = 0;
    let end = -1;
    for (let i = hit + open.length; i < out.length; i += 1) {
      const c = out[i];
      if (c === '(') depth += 1;
      else if (c === ')') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth -= 1;
      }
    }
    if (end < 0) return null;
    const arg = out.slice(hit + open.length, end);
    const wrapped = `texture(u_src, _bandUv(${arg.trim()}))`;
    out = out.slice(0, hit) + wrapped + out.slice(end + 1);
    from = hit + wrapped.length;
  }
  return out;
}
