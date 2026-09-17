/**
 * The film stocks: named parameter sets over the emulsion model, by EMULSION
 * CLASS — reversal, negative, cross-process, monochrome — never by a brand.
 * A trademark is a claim no measurement here backs, and `photo-develop.md`
 * §8's rule against a fabricated preset bites the names, not the transform:
 * each stock below is a documented physical shape, the same standing as the
 * generated `classic/` looks.
 *
 * What the numbers model, so the next person can tune them by reason:
 *
 * - `gamma` is contrast; a NEGATIVE is shot soft (0.7–0.9) and gets its
 *   contrast back from the paper, a REVERSAL is shot at its final contrast
 *   (1.1–1.3) and has no paper to rescue its whites, so it clips.
 * - Crossover is per-channel gamma: a lower BLUE gamma lifts blue below mid
 *   grey (cool shadows) and holds it back above (warm highlights) — the
 *   classic negative look. Reversed for a cross-process.
 * - `inhibition` is the saturation rolloff; slide film has less of it, which
 *   is why its colours clip where a negative's melt.
 * - `white` past 2.47 stops clips at display white; a negative's is far
 *   higher (its latitude), the paper then decides the print's white.
 *
 * Pure and DOM-free — this module must never reach for `builtin-luts.ts`,
 * whose `virtual:luts` import does not exist in a node test run.
 */

import {
  NEUTRAL_CURVE,
  sameResponse,
  type FilmCurve,
  type FilmResponse,
  type FilmSettings,
} from './emulsion';
import { DEFAULT_FILM_TEXTURE, type FilmTexture } from './film-texture';

export type FilmStockId =
  | 'reversal-vivid'
  | 'reversal-neutral'
  | 'negative-portrait'
  | 'negative-consumer'
  | 'cross-process'
  | 'mono-panchromatic';

export interface FilmStock {
  id: FilmStockId;
  /** On screen: `Reversal · vivid`. */
  name: string;
  /** One line on what the parameters model — the settled row's hint. */
  note: string;
  response: FilmResponse;
  /**
   * The stock's grain and halation — read by the render graph's film node
   * once it exists (`docs/film-simulation.md` §6), declared here so a stock
   * is one thing. Nothing draws it yet.
   */
  texture: FilmTexture;
}

/** The picker group every stock sits under, beside APPLE / DJI / SONY. */
export const FILM_GROUP_LABEL = 'FILM';

const c = (over: Partial<FilmCurve>): FilmCurve => ({ ...NEUTRAL_CURVE, ...over });
const t = (over: Partial<FilmTexture>): FilmTexture => ({ ...DEFAULT_FILM_TEXTURE, ...over });

export const FILM_STOCKS: readonly FilmStock[] = [
  {
    id: 'reversal-vivid',
    name: 'Reversal · vivid',
    note: 'Slide film at full contrast: a hard shoulder that clips its whites, deep blacks, saturated dyes that clip rather than roll off.',
    response: {
      coupling: 10,
      inhibition: 25,
      curve: {
        r: c({ gamma: 1.25, toe: 0.4, shoulder: 0.3, black: 5, white: 2.6 }),
        g: c({ gamma: 1.25, toe: 0.4, shoulder: 0.3, black: 5, white: 2.6 }),
        b: c({ gamma: 1.18, toe: 0.45, shoulder: 0.3, black: 4.8, white: 2.55 }),
      },
      print: false,
      paperGrade: 2,
      dye: 25,
      mono: null,
    },
    texture: t({ grain: 0.15, grainSize: 0.0012, grainChroma: 0.1, halation: 0.2, halationRadius: 0.03, seed: 101 }),
  },
  {
    id: 'reversal-neutral',
    name: 'Reversal · neutral',
    note: 'Slide film that means to be accurate: a little more contrast than the scene, clean neutrals, a gentler shoulder.',
    response: {
      coupling: 15,
      inhibition: 35,
      curve: {
        r: c({ gamma: 1.1, toe: 0.5, shoulder: 0.5, black: 5.5, white: 2.8 }),
        g: c({ gamma: 1.1, toe: 0.5, shoulder: 0.5, black: 5.5, white: 2.8 }),
        b: c({ gamma: 1.07, toe: 0.5, shoulder: 0.5, black: 5.5, white: 2.8 }),
      },
      print: false,
      paperGrade: 2,
      dye: 5,
      mono: null,
    },
    texture: t({ grain: 0.12, grainSize: 0.0012, grainChroma: 0.1, halation: 0.15, halationRadius: 0.03, seed: 102 }),
  },
  {
    id: 'negative-portrait',
    name: 'Negative · portrait',
    note: 'A soft negative with wide latitude, printed: cool shadows under warm highlights, strong coupler rolloff that protects skin, dyes held back.',
    response: {
      coupling: 30,
      inhibition: 55,
      curve: {
        r: c({ gamma: 0.78, toe: 0.9, shoulder: 1.0, black: 6.5, white: 4 }),
        g: c({ gamma: 0.75, toe: 0.9, shoulder: 1.0, black: 6.5, white: 4 }),
        b: c({ gamma: 0.7, toe: 1.1, shoulder: 1.1, black: 6.2, white: 3.8 }),
      },
      print: true,
      paperGrade: 2.5,
      dye: -5,
      mono: null,
    },
    texture: t({ grain: 0.3, grainSize: 0.0016, grainChroma: 0.25, halation: 0.35, halationRadius: 0.04, seed: 103 }),
  },
  {
    id: 'negative-consumer',
    name: 'Negative · consumer',
    note: 'An everyday negative printed on a harder paper: punchier, a green-yellow lean in the highlights, dyes a little louder.',
    response: {
      coupling: 25,
      inhibition: 40,
      curve: {
        r: c({ gamma: 0.88, toe: 0.8, shoulder: 0.8, black: 6, white: 3.6 }),
        g: c({ gamma: 0.85, toe: 0.8, shoulder: 0.8, black: 6, white: 3.6 }),
        b: c({ gamma: 0.78, toe: 0.9, shoulder: 0.7, black: 5.8, white: 3.2 }),
      },
      print: true,
      paperGrade: 3,
      dye: 15,
      mono: null,
    },
    texture: t({ grain: 0.4, grainSize: 0.002, grainChroma: 0.3, halation: 0.3, halationRadius: 0.04, seed: 104 }),
  },
  {
    id: 'cross-process',
    name: 'Cross-process',
    note: 'Slide film run through the wrong chemistry: contrast run up, the crossover broken the other way — cyan shadows, yellow highlights, little rolloff.',
    response: {
      coupling: 5,
      inhibition: 10,
      curve: {
        r: c({ speed: -0.1, gamma: 1.4, toe: 0.3, shoulder: 0.3, black: 4.5, white: 2.5 }),
        g: c({ gamma: 1.2, toe: 0.3, shoulder: 0.3, black: 4.5, white: 2.5 }),
        b: c({ speed: 0.3, gamma: 0.8, toe: 0.3, shoulder: 0.3, black: 4.5, white: 2.5 }),
      },
      print: false,
      paperGrade: 2,
      dye: 30,
      mono: null,
    },
    texture: t({ grain: 0.35, grainSize: 0.0018, grainChroma: 0.35, halation: 0.2, halationRadius: 0.035, seed: 105 }),
  },
  {
    id: 'mono-panchromatic',
    name: 'Monochrome · panchromatic',
    note: 'One panchromatic layer behind an orange filter, printed: skies darken, skin lightens, a long toe and a crisp paper white.',
    response: {
      coupling: 0,
      inhibition: 0,
      curve: {
        r: c({ gamma: 1.15, toe: 0.6, shoulder: 0.6, black: 6, white: 3.5 }),
        g: c({ gamma: 1.15, toe: 0.6, shoulder: 0.6, black: 6, white: 3.5 }),
        b: c({ gamma: 1.15, toe: 0.6, shoulder: 0.6, black: 6, white: 3.5 }),
      },
      print: true,
      paperGrade: 2.5,
      dye: 0,
      mono: { sensitivity: [0.3, 0.45, 0.25], filter: [1, 0.55, 0.2] },
    },
    texture: t({ grain: 0.45, grainSize: 0.0018, grainChroma: 0, halation: 0.15, halationRadius: 0.035, halationTint: [1, 0.92, 0.8], seed: 106 }),
  },
];

const BY_ID: ReadonlyMap<string, FilmStock> = new Map(FILM_STOCKS.map((s) => [s.id, s]));

export function filmStock(id: string): FilmStock | null {
  return BY_ID.get(id) ?? null;
}

/** Fresh settings seeded from a stock — the numbers copied, so a dial never edits the registry. */
export function filmSettingsFor(id: FilmStockId): FilmSettings {
  const stock = BY_ID.get(id)!;
  return { stock: id, response: structuredClone(stock.response) };
}

/** True when the settings still carry their stock's own numbers. */
export function onStock(settings: FilmSettings): boolean {
  const stock = BY_ID.get(settings.stock);
  return !!stock && sameResponse(stock.response, settings.response);
}

/**
 * The one line a settled row prints: the stock's name, `· adjusted` once a
 * dial moved it, `Film · adjusted` for settings whose stock this build no
 * longer knows.
 */
export function describeFilm(settings: FilmSettings): string {
  const stock = BY_ID.get(settings.stock);
  if (!stock) return 'Film · adjusted';
  return onStock(settings) ? stock.name : `${stock.name} · adjusted`;
}
