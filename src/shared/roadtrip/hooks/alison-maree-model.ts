/**
 * The Alison Maree — Naturaliste Charters' catamaran that takes the Bremer
 * Canyon's orcas out of Bremer Bay: some 20–23 m (sources disagree), built in
 * Western Australia for the Southern Ocean, three viewing decks (the bow, a
 * big lower rear deck, a big upper one) and an air-conditioned wheelhouse with
 * a view all round. Drawn by `buildCatamaran` (`boat-parts.ts`): its upper
 * deck reaches far aft over the rear deck, and its wheelhouse is glass on
 * every side.
 *
 * Metres: 22 long, 8.1 wide, a higher freeboard than the Whitsundays boat's
 * and the heights a toy's, a size up.
 * The livery — a white hull with a navy line — is a guess from the operator's
 * descriptions, which say nothing of colour; the author can repaint it. Pure
 * and DOM-free.
 */

import { buildCatamaran, type CatamaranShape } from './boat-parts';
import type { Part } from './mesh3d';

export const ALISON_LENGTH = 22;
export const ALISON_WIDTH = 8.1;

const SHAPE: CatamaranShape = {
  hull: { offset: 2.95, stern: -11, bow: 11, forefoot: 9.8, taper: 6, deckHalf: 1.1, waterHalf: 0.85, freeboard: 2 },
  bridge: { fore: 7.2, depth: 0.35 },
  saloon: { x: 3.7, aft: -3.5, fore: 5, height: 2.7, rake: 1, windows: [-3, 3.3] },
  upper: { aft: -9.5, thick: 0.15 },
  wheelhouse: { x: 2.6, aft: 0.4, fore: 4, height: 2.4, rake: 0.6, panoramic: true },
  stripe: [1.05, 1.75],
};

/** The boat's colours by role; the hull's is the author's. */
export function alisonPalette(hull: string): Record<string, string> {
  return {
    body: hull,
    deck: '#c9ced2',
    deckUpper: '#dadee0',
    cabin: '#f5f6f4',
    roof: '#e6e8ea',
    glass: '#233446',
    glassDark: '#16202b',
    rail: '#eceeef',
    mast: '#4b5057',
    stripe: '#1e3f7a',
  };
}

export function buildAlisonMaree(): Part[] {
  return buildCatamaran(SHAPE);
}
