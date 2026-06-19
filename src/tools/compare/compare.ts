/**
 * Pure helpers for the A/B compare wipe — no DOM, no React.
 *
 * The compare stage layers two media (A underneath, B on top); the B layer is
 * clipped so it shows only to the *right* of the divider, revealing A on the
 * left. {@link insetForSplit} builds that clip, and {@link reconcilePair} keeps
 * the two chosen sides valid as the library selection changes.
 */

/** Clamp to the 0..1 range a normalised divider position lives in. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * `clip-path` for the top (B) layer so it shows only the portion to the right
 * of `split` (0..1) — i.e. inset from the left by `split`. Trailing zeros are
 * trimmed for a tidy style string.
 */
export function insetForSplit(split: number): string {
  const pct = (clamp01(split) * 100).toFixed(4).replace(/\.?0+$/, '');
  return `inset(0 0 0 ${pct}%)`;
}

/**
 * Choose the A and B asset ids given the previous choice and the ids currently
 * available (the selected, usable assets). Keeps a still-valid choice stable,
 * fills empty slots from the pool, dedupes (A and B can't be the same), and
 * collapses a lone asset into A so B is only set once a real pair exists.
 */
export function reconcilePair(
  a: string | null,
  b: string | null,
  available: readonly string[],
): { a: string | null; b: string | null } {
  const set = new Set(available);
  let na = a && set.has(a) ? a : null;
  let nb = b && set.has(b) ? b : null;
  if (nb && nb === na) nb = null;

  const used = new Set<string>();
  if (na) used.add(na);
  if (nb) used.add(nb);
  const pool = available.filter((id) => !used.has(id));

  let i = 0;
  if (!na && i < pool.length) na = pool[i++];
  if (!nb && i < pool.length) nb = pool[i++];
  // A lone asset belongs in A, never B.
  if (!na && nb) {
    na = nb;
    nb = null;
  }
  return { a: na, b: nb };
}
