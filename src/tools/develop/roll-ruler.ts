/**
 * The band head's RULER on a phone (2026-10-21, his pick C of the band-head
 * lab https://claude.ai/artifact/Cq3WXuQp3tkvfgxFihV4hP): the pictures the
 * band shows, one tick each, the open one marked — and a finger dragged
 * along it travels the roll without scrolling the cells one by one.
 *
 * Pure: where a pointer lands, and whether the ticks still read as ticks.
 */

/** Past this many pictures a tick would be under 1.5 px on a phone: the ruler is drawn as one track and a mark. */
export const RULER_MAX_TICKS = 96;

/** The picture under `x` on a ruler `width` wide holding `count` (an even share each, the ends clamped). */
export function rulerIndex(x: number, width: number, count: number): number {
  if (count <= 0 || !(width > 0)) return -1;
  const at = Math.floor((x / width) * count);
  return Math.min(count - 1, Math.max(0, at));
}

/** Where picture `index` sits along the ruler, as a fraction of its width — the middle of its share. */
export function rulerFraction(index: number, count: number): number {
  if (count <= 0 || index < 0) return 0;
  return (Math.min(index, count - 1) + 0.5) / count;
}

/** Whether `count` pictures are drawn as ticks (else a track with one mark). */
export function rulerTicks(count: number): boolean {
  return count > 0 && count <= RULER_MAX_TICKS;
}

/** The ruler's arrow keys: one picture, Home and End the two ends; null for any other key. */
export function rulerKey(key: string, at: number, count: number): number | null {
  if (count <= 0) return null;
  const from = Math.max(0, at);
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(0, from - 1);
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(count - 1, from + 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
