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
