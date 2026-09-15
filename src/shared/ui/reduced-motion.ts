/**
 * Whether the person asked the system for less motion.
 *
 * Read at the moment it matters rather than subscribed to: the callers are a
 * fling deciding its momentum (`DeckStrip`) and a turntable deciding whether
 * to keep turning (`CarTurntable`), and each asks again at its next gesture.
 * Safe where there is no window (tests, a worker): that is simply "no".
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
