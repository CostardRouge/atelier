/**
 * The badge variant — the hook every piece has always had, expressed against
 * the engine's own contract.
 *
 * It draws nothing of its own and rewrites nothing: the six text pieces are
 * built by `badgeElements` and painted by `drawOverlays` exactly as before, so
 * adopting the engine changes no pixel. That is the point — a seam is only
 * known to be right once something ordinary passes through it unharmed.
 */

import { DEFAULT_HOOK_ID, type HookVariant } from './hook-variant';

const NOTHING = { seconds: 0 } as const;

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
};
