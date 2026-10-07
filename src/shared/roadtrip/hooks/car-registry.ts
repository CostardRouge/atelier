/**
 * The vehicles a Virée may drive — one registry line per model, the way the
 * tools and the hook variants are listed.
 *
 * Four cars: the Toyota Land Cruiser Prado of the J120 series (`car-model.ts`),
 * the maintainer's own, the Renault Kadjar of the facelift
 * (`kadjar-model.ts`), the Renault Trafic panel van with the solar panel
 * on its roof (`trafic-model.ts`) and the Renault Zoé (`zoe-model.ts`), the
 * last three over `car-parts.ts`. Four boats: the
 * Whitsundays day cruiser, the Viper, the Alison Maree and the Solar Whisper
 * (`*-model.ts` over `boat-parts.ts`).
 * Another is one more `*-model.ts` over `mesh3d.ts`, one line here and one `CarLine` in
 * `car-spec.ts` (what it offers and how it comes); its parts must stay
 * CONVEX, or the painter's ordering breaks, and `render-order.test.ts` judges
 * every line of this list. Pure and DOM-free.
 */

import { CAR_LENGTH, CAR_WIDTH, WHEEL_RADIUS, buildCar, carPalette } from './car-model';
import { KADJAR_LENGTH, KADJAR_WIDTH, KADJAR_WHEEL_RADIUS, buildKadjar, kadjarPalette } from './kadjar-model';
import { TRAFIC_LENGTH, TRAFIC_WIDTH, TRAFIC_WHEEL_RADIUS, buildTrafic, traficPalette } from './trafic-model';
import { ZOE_LENGTH, ZOE_WIDTH, ZOE_WHEEL_RADIUS, buildZoe, zoePalette } from './zoe-model';
import { ALISON_LENGTH, ALISON_WIDTH, alisonPalette, buildAlisonMaree } from './alison-maree-model';
import { VIPER_LENGTH, VIPER_WIDTH, buildViper, viperPalette } from './viper-model';
import { WHISPER_LENGTH, WHISPER_WIDTH, buildSolarWhisper, whisperPalette } from './solar-whisper-model';
import { CRUISER_LENGTH, CRUISER_WIDTH, buildCruiser, cruiserPalette } from './whitsunday-cruiser-model';
import { DEFAULT_MODEL, type CarGear, type CarModelId } from '../car-spec';
import type { Part } from './mesh3d';

export interface CarModel {
  id: CarModelId;
  /** A car rolls on wheels and throws a shadow; a boat leaves a wake. */
  kind: 'car' | 'boat';
  /** The make and the model, as said on screen. */
  name: string;
  /** The model alone, for a verb about it ("Back to the default Kadjar"). */
  short: string;
  /** The series and its years. */
  series: string;
  /** The footprint in model units — the shadow and the scale on the map read it. */
  length: number;
  width: number;
  /** What a turn of the wheels covers; a boat has none, so nothing reads it. */
  wheelRadius: number;
  /** How much water a boat throws behind it, 1 by default: faint for one that glides, long for a jet. */
  wake?: number;
  build(gear: CarGear): Part[];
  /** Its colours by role, given the author's body colour. */
  palette(bodyColor: string): Record<string, string>;
}

export const CAR_MODELS: readonly CarModel[] = [
  {
    id: 'prado-j120',
    kind: 'car',
    name: 'Toyota Land Cruiser Prado',
    short: 'Prado',
    series: 'J120 · 2003–2009',
    length: CAR_LENGTH,
    width: CAR_WIDTH,
    wheelRadius: WHEEL_RADIUS,
    build: buildCar,
    palette: carPalette,
  },
  {
    id: 'kadjar-ph2',
    kind: 'car',
    name: 'Renault Kadjar',
    short: 'Kadjar',
    series: 'Phase 2 · 2018–2022',
    length: KADJAR_LENGTH,
    width: KADJAR_WIDTH,
    wheelRadius: KADJAR_WHEEL_RADIUS,
    build: buildKadjar,
    palette: kadjarPalette,
  },
  {
    id: 'trafic-ph2',
    kind: 'car',
    name: 'Renault Trafic',
    short: 'Trafic',
    series: 'Panel van · 2019–2021 facelift',
    length: TRAFIC_LENGTH,
    width: TRAFIC_WIDTH,
    wheelRadius: TRAFIC_WHEEL_RADIUS,
    build: buildTrafic,
    palette: traficPalette,
  },
  {
    id: 'zoe-ph2',
    kind: 'car',
    name: 'Renault Zoé',
    short: 'Zoé',
    series: 'Phase 2 · 2019–2024',
    length: ZOE_LENGTH,
    width: ZOE_WIDTH,
    wheelRadius: ZOE_WHEEL_RADIUS,
    build: buildZoe,
    palette: zoePalette,
  },
  {
    id: 'whitsunday-cruiser',
    kind: 'boat',
    name: 'Whitsundays day cruiser',
    short: 'day cruiser',
    series: 'Catamaran · Airlie Beach to Whitehaven',
    length: CRUISER_LENGTH,
    width: CRUISER_WIDTH,
    wheelRadius: 1,
    build: buildCruiser,
    palette: cruiserPalette,
  },
  {
    id: 'viper-jet',
    kind: 'boat',
    name: 'Viper',
    short: 'Viper',
    series: 'Jet boat · Airlie Beach to the outer reef',
    length: VIPER_LENGTH,
    width: VIPER_WIDTH,
    wheelRadius: 1,
    // The fastest boat in the Whitsundays throws the longest wake.
    wake: 1.5,
    build: buildViper,
    palette: viperPalette,
  },
  {
    id: 'alison-maree',
    kind: 'boat',
    name: 'Alison Maree',
    short: 'Alison Maree',
    series: 'Catamaran · Bremer Bay, to the canyon’s orcas',
    length: ALISON_LENGTH,
    width: ALISON_WIDTH,
    wheelRadius: 1,
    build: buildAlisonMaree,
    palette: alisonPalette,
  },
  {
    id: 'solar-whisper',
    kind: 'boat',
    name: 'Solar Whisper',
    short: 'Solar Whisper',
    series: 'Electric · Daintree River, to the crocodiles',
    length: WHISPER_LENGTH,
    width: WHISPER_WIDTH,
    wheelRadius: 1,
    // Electric and silent: it glides, and barely marks the river.
    wake: 0.35,
    build: buildSolarWhisper,
    palette: whisperPalette,
  },
];

/** How a model is named in a list of every vehicle: a boat says so. */
export function vehicleLabel(model: CarModel): string {
  return model.kind === 'boat' ? `Boat · ${model.name}` : model.name;
}

/** The model an id names — the default car for one this build does not know. */
export function carModel(id: string): CarModel {
  return CAR_MODELS.find((model) => model.id === id) ?? CAR_MODELS.find((model) => model.id === DEFAULT_MODEL) ?? CAR_MODELS[0];
}
