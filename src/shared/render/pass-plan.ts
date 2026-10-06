/**
 * Which buffer each pass reads from and writes to — the render core's
 * ping-pong, as arithmetic.
 *
 * Apart from the GL because this is where a multi-pass renderer goes wrong in
 * a way nothing catches: a pass that reads and writes the same target samples
 * what it is drawing, and an off-by-one at the end leaves the result in a
 * buffer nobody shows. Both are silent — the picture is simply subtly or
 * entirely wrong — so the arithmetic is pure and pinned by specs instead of
 * being read back off a GPU.
 *
 * The property that matters most: **at ONE pass the plan is source → canvas,
 * with no framebuffer at all**, which is exactly what `lut-gl.ts` has always
 * done. The common case is therefore not a special case bolted on, it is the
 * general algorithm at n = 1 — which is what lets the core replace the old
 * renderer with a pixel-identical result.
 *
 * Pure and DOM-free.
 */

/** Where a pass reads: the uploaded source, or one of the two ping-pong targets. */
export type PassSource = 'source' | 0 | 1;
/** Where a pass writes: a ping-pong target, or the canvas the viewer sees. */
export type PassTarget = 0 | 1 | 'canvas';

export interface PassSlot {
  from: PassSource;
  to: PassTarget;
}

/**
 * The read/write plan for `count` passes.
 *
 * The first reads the source; the last writes the canvas; everything between
 * alternates. Two targets are enough however long the chain: a pass never
 * needs anything older than what the one before it produced.
 */
export function planPasses(count: number): PassSlot[] {
  const n = Math.max(0, Math.floor(count));
  const slots: PassSlot[] = [];
  for (let i = 0; i < n; i += 1) {
    slots.push({
      from: i === 0 ? 'source' : ((i - 1) % 2 as 0 | 1),
      to: i === n - 1 ? 'canvas' : ((i % 2) as 0 | 1),
    });
  }
  return slots;
}

/** How many ping-pong targets a plan actually needs — 0 for the single-pass case. */
export function targetsNeeded(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n <= 1) return 0;
  return n === 2 ? 1 : 2;
}

/**
 * Where a render RESUMES, and what it keeps for the next one — the kept
 * upstream, as arithmetic.
 *
 * A render keeps the output of ONE pass (the checkpoint, `held`) in a texture
 * of its own. The next render compares its passes' keys (`RenderPass.key`)
 * with the last render's: the longest prefix whose keys match is work already
 * done, and when the checkpoint sits inside that prefix the render starts
 * right after it. The checkpoint is then moved to the input of the first
 * pass that CHANGED — a slider being dragged changes the same pass on every
 * step, so from the third render on each step draws that pass and what
 * follows it, and nothing before.
 *
 * `start` is the first pass to draw (`keys.length` when nothing changed and
 * the canvas already holds the picture); `keep` the pass whose output to hold
 * afterwards, −1 for none. `keep ≥ start` means that pass's output is written
 * into the checkpoint as it is drawn; `keep < start` means the checkpoint
 * already holds it. The last pass is never kept: it writes the canvas.
 */
export interface ResumePlan {
  start: number;
  keep: number;
}

export function planResume(
  prev: readonly (string | null)[],
  keys: readonly (string | null)[],
  held: number,
): ResumePlan {
  const n = keys.length;
  let p = 0;
  while (p < n && p < prev.length && keys[p] !== null && keys[p] === prev[p]) p += 1;
  if (n > 0 && p === n) return { start: n, keep: held >= 0 && held < n - 1 ? held : -1 };
  const valid = held >= 0 && held < p;
  const start = valid ? held + 1 : 0;
  // Nothing known about the last render: draw whole and keep nothing — a
  // one-shot render (an export, a thumbnail) then never pays for a texture.
  const keep = prev.length === 0 ? -1 : Math.min(p - 1, n - 2);
  return { start, keep: keep >= 0 ? keep : -1 };
}
