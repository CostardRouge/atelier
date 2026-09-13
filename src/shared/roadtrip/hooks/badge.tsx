/**
 * The badge variant — the hook every piece has always had, expressed against
 * the engine's own contract.
 *
 * It draws nothing of its own and rewrites nothing: the six text pieces are
 * built by `badgeElements` and painted by `drawOverlays` exactly as before, so
 * adopting the engine changes no pixel. That is the point — a seam is only
 * known to be right once something ordinary passes through it unharmed.
 *
 * It has no options either, so it has no `Panel`: the picker shows nothing
 * under it, which is the honest face of a variant with nothing to set.
 */

import { DEFAULT_HOOK_ID, type HookVariant } from './hook-variant';

const NOTHING = { seconds: 0 } as const;

/**
 * The picker card's drawing: the block the badge actually is — a word, a
 * numeral that dominates, a place under it. Deliberately not a render of this
 * piece; the stage beside the picker is already showing that.
 */
function BadgeSketch() {
  return (
    <span className="flex flex-col items-start gap-[2px] leading-none" aria-hidden="true">
      <span className="block h-[2px] w-3 rounded-full bg-white/55" />
      <span className="block font-sans text-base font-bold text-white">27</span>
      <span className="block h-[2px] w-5 rounded-full bg-white/40" />
    </span>
  );
}

export const badgeVariant: HookVariant = {
  id: DEFAULT_HOOK_ID,
  name: 'Badge',
  tagline: 'The counter, the place and the day — nothing behind them',
  defaults: {},
  needs: {},
  owns: 'layer',
  prepare() {
    return NOTHING;
  },
  Sketch: BadgeSketch,
};
