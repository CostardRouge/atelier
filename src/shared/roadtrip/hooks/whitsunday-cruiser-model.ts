/**
 * The Whitsundays day cruiser — the ordinary boat out of Airlie Beach to
 * Whitehaven: a motor catamaran with an enclosed saloon, a rear deck under an
 * upper deck, a wheelhouse with windows and a shade roof over the upper deck. Not one named vessel; the
 * shape the day fleet shares, drawn by `buildCatamaran` (`boat-parts.ts`).
 *
 * Metres: 24 long, 8.5 wide over the hulls, the heights a toy's — a size up,
 * as the cars' wheels are, or it reads as a barge from above. The livery — a white hull with a
 * teal line — is a guess the author can repaint; nothing here claims an
 * operator's colours. Pure and DOM-free.
 */

import { buildCatamaran, type CatamaranShape } from './boat-parts';
import type { Part } from './mesh3d';

export const CRUISER_LENGTH = 24;
export const CRUISER_WIDTH = 8.5;

const SHAPE: CatamaranShape = {
  hull: { offset: 3.05, stern: -12, bow: 12, forefoot: 10.8, taper: 6.5, deckHalf: 1.2, waterHalf: 0.9, freeboard: 1.7 },
  bridge: { fore: 7.5, depth: 0.35 },
  saloon: { x: 3.9, aft: -6, fore: 5.2, height: 2.5, rake: 1.2, windows: [-5.4, 3.4] },
  upper: { aft: -9, thick: 0.15 },
  wheelhouse: { x: 2, aft: 1.2, fore: 4, height: 2.1, rake: 0.6, panoramic: false },
  stripe: [0.85, 1.4],
  canopy: { height: 2.3 },
};

/** The boat's colours by role; the hull's is the author's. */
export function cruiserPalette(hull: string): Record<string, string> {
  return {
    body: hull,
    deck: '#cdd1d4',
    deckUpper: '#c9dcd9',
    canopy: '#f2f4f3',
    cabin: '#f6f6f3',
    roof: '#e8eaeb',
    glass: '#24394b',
    glassDark: '#1b2632',
    rail: '#eef0f0',
    mast: '#51565c',
    stripe: '#16999a',
  };
}

export function buildCruiser(): Part[] {
  return buildCatamaran(SHAPE);
}
