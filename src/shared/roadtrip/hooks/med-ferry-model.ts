/**
 * The Mediterranean ferry — the ro-pax that crosses between France, Spain
 * and Morocco (Sète or Marseille to Tanger, Algeciras or Tarifa to Tanger
 * Med, Barcelona to the Balearics): not one named ship but the shape that
 * fleet shares, a hull of about 175 × 27.6 m, a long open aft deck, the
 * superstructure forward of it, TWO funnels side by side aft — which is what
 * tells it from the Spirit of Tasmania's one — and a bow that opens. Drawn by
 * `buildRopax` (`ferry-parts.ts`), 32 m in the beam, a size up as the Spirit is.
 *
 * The livery is a guess: a navy hull under a white superstructure, the way
 * the ship of the maintainer's own Tanger Med photograph is painted (the deck
 * the Vitrine's ferry place is drawn from), a white line along the hull and
 * navy funnels banded white. No operator's colours are claimed; the author
 * repaints the hull, and the funnels follow it. Pure and DOM-free.
 */

import { buildRopax, ropaxRamps, type RopaxShape } from './ferry-parts';
import type { Part } from './mesh3d';

export const MED_FERRY_LENGTH = 175;
/** Over the bridge wings, 2.2 m past each side of the drawn 32 m beam. */
export const MED_FERRY_WIDTH = 36.4;

const SHAPE: RopaxShape = {
  hull: { stern: -87.5, bow: 87.5, forefoot: 79, taper: 44, deckHalf: 16, waterHalf: 15, freeboard: 11 },
  tiersAft: [-58, -50, 10],
  front: 38,
  heights: [8.5, 7.5, 4.2],
  cuts: [-20],
  wings: 2.2,
  funnels: { count: 2, aft: -46, fore: -36, half: 2.2, height: 11, lean: 2 },
  lifeboats: { count: 5, aft: -32, fore: 8 },
  stripe: [1.6, 3],
};

/** The ship's colours by role; the hull's is the author's, and the funnels wear it too. */
export function medFerryPalette(hull: string): Record<string, string> {
  return {
    body: hull,
    deck: '#8f969c',
    cabin: '#f5f6f4',
    roof: '#dde0e2',
    glass: '#2a3c4c',
    glassDark: '#1b2632',
    stripe: '#f5f6f4',
    funnel: hull,
    funnelBand: '#f5f6f4',
    funnelTop: '#1d1f23',
    lifeboat: '#f07c22',
    door: '#3b4046',
    ramp: '#6f757b',
    mast: '#4b5057',
    winch: '#5d6369',
    rail: '#eceeef',
  };
}

export function buildMedFerry(): Part[] {
  return buildRopax(SHAPE);
}

export function medFerryRamps(): { stern: Part[]; bow: Part[] } {
  return ropaxRamps(SHAPE);
}
