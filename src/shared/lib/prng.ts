/**
 * ONE seeded generator for everything in the suite that must draw the same
 * numbers twice — a stagger's random order, a film's grain field. mulberry32:
 * 32-bit state, good enough spread, and the same seed shuffles the same way
 * in every browser and in node. `Math.random()` has no place on a path whose
 * output is stored or exported (`roadtrip.md`, the seeded voices).
 */
export function mulberry32(seed: number): () => number {
  // `| 0`, exactly as the stagger's private copy did: a stored seed must
  // keep shuffling the same way after the move.
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
