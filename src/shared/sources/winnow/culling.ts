/**
 * Winnow's CULLING, as Atelier reads it — never writes it.
 *
 * Culling is Winnow's job (`docs/develop-tool.md` §8), and the maintainer's
 * answer of 2026-09-23 (`docs/lightroom-gaps.md` §8, item 33) is that Develop
 * SHOWS it and FILTERS on it, and never sets it. So what is here is a reader of
 * the row Winnow already sends (`GRID_SELECT` joins `ratings` into every row
 * of `/api/assets`) and a filter over what it read.
 *
 * - **The verdict** is Winnow's own vocabulary, checked against its schema
 *   (migrations 0001 and 0016): `pick`, `reject`, `skip` (swiped past in
 *   Sift) and `unrated`. Anything else reads as `unrated` rather than as a
 *   verdict nobody gave.
 * - **Stars** are 0 to 5; a value off that scale is clamped, not trusted.
 * - **A colour label** is a free string on Winnow's side — no screen of its
 *   own sets it today. It is shown only when it is one of the five names
 *   Lightroom and Capture One share; any other text is kept for the tooltip.
 *
 * A picture that did not come from an instance, or whose instance has not
 * answered, has NO culling (`undefined`) — which is not the same as unrated,
 * and the filter says so rather than hiding it as if it had been rejected.
 *
 * Pure and DOM-free.
 */

export type Verdict = 'pick' | 'reject' | 'skip' | 'unrated';

export interface Culling {
  verdict: Verdict;
  /** 0 to 5; 0 is no stars. */
  star: number;
  /** The label as Winnow holds it, or null for none. */
  color: string | null;
}

const VERDICTS: readonly Verdict[] = ['pick', 'reject', 'skip', 'unrated'];

/** The culling a Winnow row carries, or null when the row says nothing of it (an older instance). */
export function cullingFromRow(row: { verdict?: unknown; star?: unknown; color_label?: unknown }): Culling | null {
  if (row.verdict === undefined && row.star === undefined && row.color_label === undefined) return null;
  const verdict = VERDICTS.includes(row.verdict as Verdict) ? (row.verdict as Verdict) : 'unrated';
  const star = typeof row.star === 'number' && Number.isFinite(row.star) ? Math.max(0, Math.min(5, Math.round(row.star))) : 0;
  const color = typeof row.color_label === 'string' && row.color_label.trim() ? row.color_label.trim() : null;
  return { verdict, star, color };
}

/** True when Winnow has said anything about this picture beyond "not looked at". */
export function isCulled(c: Culling | null | undefined): boolean {
  return Boolean(c && (c.verdict !== 'unrated' || c.star > 0 || c.color));
}

/** The five labels Lightroom and Capture One share, by the name Winnow would store. */
export const LABEL_COLOURS = ['red', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelColour = (typeof LABEL_COLOURS)[number];

/** A stored label as one of the five, or null for none or a free text. */
export function labelColour(color: string | null | undefined): LabelColour | null {
  const c = color?.trim().toLowerCase();
  return c && (LABEL_COLOURS as readonly string[]).includes(c) ? (c as LabelColour) : null;
}

/** `Pick · ★★★ · red` — what Winnow said, in a line; empty for nothing. */
export function describeCulling(c: Culling | null | undefined): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.verdict === 'pick') parts.push('Pick');
  else if (c.verdict === 'reject') parts.push('Rejected');
  else if (c.verdict === 'skip') parts.push('Skipped');
  if (c.star > 0) parts.push('★'.repeat(c.star));
  if (c.color) parts.push(c.color);
  return parts.join(' · ');
}

// --- the filter ----------------------------------------------------------------

/**
 * What the strip shows, on Winnow's word. `all` is no filter; `picks` is
 * Winnow's picks alone; `unrejected` leaves the rejects out and keeps
 * everything else, a picture Winnow never saw included; `stars` keeps a
 * picture with at least `min` stars.
 */
export type CullFilter =
  | { kind: 'all' }
  | { kind: 'picks' }
  | { kind: 'unrejected' }
  | { kind: 'stars'; min: number };

export const NO_CULL_FILTER: CullFilter = { kind: 'all' };

/** Every filter the menu offers, in its order. */
export const CULL_FILTERS: readonly CullFilter[] = [
  { kind: 'all' },
  { kind: 'picks' },
  { kind: 'unrejected' },
  ...[1, 2, 3, 4, 5].map((min) => ({ kind: 'stars' as const, min })),
];

export function cullFilterKey(f: CullFilter): string {
  return f.kind === 'stars' ? `stars:${f.min}` : f.kind;
}

/** A stored key read back; anything unknown is no filter. */
export function readCullFilter(key: unknown): CullFilter {
  return CULL_FILTERS.find((f) => cullFilterKey(f) === key) ?? NO_CULL_FILTER;
}

export function cullFilterLabel(f: CullFilter): string {
  switch (f.kind) {
    case 'all':
      return 'All';
    case 'picks':
      return 'Picks';
    case 'unrejected':
      return 'Not rejected';
    case 'stars':
      return `${'★'.repeat(f.min)}${f.min < 5 ? ' and up' : ''}`;
  }
}

/**
 * Whether a picture passes. A picture Winnow has said NOTHING about
 * (`undefined`: from this computer, or its instance not answering) passes
 * only the filters that do not ask Winnow for a yes — `all` and
 * `unrejected` — because nothing says it was rejected, and nothing says it
 * was picked either.
 */
export function passesCull(c: Culling | null | undefined, f: CullFilter): boolean {
  switch (f.kind) {
    case 'all':
      return true;
    case 'unrejected':
      return c?.verdict !== 'reject';
    case 'picks':
      return c?.verdict === 'pick';
    case 'stars':
      return (c?.star ?? 0) >= f.min;
  }
}

/** How a roll's pictures stand against Winnow, for the status line. */
export interface CullCounts {
  /** Pictures Winnow answered for. */
  known: number;
  picks: number;
  rejects: number;
  starred: number;
}

export function countCulling(cullings: Iterable<Culling | null | undefined>): CullCounts {
  const out: CullCounts = { known: 0, picks: 0, rejects: 0, starred: 0 };
  for (const c of cullings) {
    if (!c) continue;
    out.known += 1;
    if (c.verdict === 'pick') out.picks += 1;
    if (c.verdict === 'reject') out.rejects += 1;
    if (c.star > 0) out.starred += 1;
  }
  return out;
}
