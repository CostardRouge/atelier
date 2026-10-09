/**
 * The Spirit of Tasmania — TT-Line's ro-pax across Bass Strait, Geelong to
 * Devonport overnight, cars and caravans on its decks: Spirit of Tasmania I
 * and II, 194.3 m long, 25 m in the beam (the operator's figures; the IV
 * that arrives in 2026 is 212 × 31). Drawn by `buildRopax`
 * (`ferry-parts.ts`): a long white hull, the superstructure stepping up
 * from an aft terrace to the bridge and its wings, one funnel leaning aft, a
 * row of lifeboats down each side, the stern door the cars drive in by.
 * Drawn 30 m in the beam, a size up on the real 25 — the catamarans' rule:
 * at its true slenderness a ship reads as a stick at map size, and the car
 * driving aboard would be as wide as its hull.
 *
 * The livery keeps to what the operator says of it — its red, «red curves on
 * the hull and funnel» — drawn as a red band along the hull and a red
 * funnel; the curves themselves are not drawn, and the author can repaint
 * the hull. Pure and DOM-free.
 */

import { buildRopax, ropaxRamps, type RopaxShape } from './ferry-parts';
import type { Part } from './mesh3d';

export const SPIRIT_LENGTH = 194.3;
/** Over the bridge wings, 2.5 m past each side of the drawn 30 m beam. */
export const SPIRIT_WIDTH = 35;

const SHAPE: RopaxShape = {
  hull: { stern: -97, bow: 97.3, forefoot: 88, taper: 52, deckHalf: 15, waterHalf: 14, freeboard: 12 },
  tiersAft: [-80, -66, 14],
  front: 46,
  heights: [9, 7, 4.5],
  cuts: [-40, 0],
  wings: 2.5,
  funnels: { count: 1, aft: -60, fore: -48, half: 3.2, height: 13, lean: 2.5 },
  lifeboats: { count: 6, aft: -44, fore: 12 },
  stripe: [2, 4.2],
};

/** The ship's colours by role; the hull's is the author's. */
export function spiritPalette(hull: string): Record<string, string> {
  return {
    body: hull,
    deck: '#9aa1a6',
    cabin: '#f6f6f3',
    roof: '#dfe2e3',
    glass: '#2a3c4c',
    glassDark: '#1b2632',
    stripe: '#c8102e',
    funnel: '#c8102e',
    funnelBand: '#f6f6f3',
    funnelTop: '#1d1f23',
    lifeboat: '#f07c22',
    door: '#3b4046',
    ramp: '#6f757b',
    mast: '#4b5057',
    winch: '#5d6369',
    rail: '#eceeef',
  };
}

export function buildSpiritOfTasmania(): Part[] {
  return buildRopax(SHAPE);
}

export function spiritRamps(): { stern: Part[]; bow: Part[] } {
  return ropaxRamps(SHAPE);
}
