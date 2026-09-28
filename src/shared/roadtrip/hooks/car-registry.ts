/**
 * The cars a trip may drive — one registry line per model, the way the tools
 * and the hook variants are listed.
 *
 * Two today: the Toyota Land Cruiser Prado of the J120 series (`car-model.ts`),
 * the maintainer's own, and the Renault Kadjar of the facelift
 * (`kadjar-model.ts`). A third car is a third `*-model.ts` over `mesh3d.ts`,
 * one line here and one `CarLine` in `car-spec.ts` (what it offers and how it
 * comes); its parts must stay CONVEX, or the painter's ordering breaks, and
 * `render-order.test.ts` judges every line of this list. Pure and DOM-free.
 */

import { CAR_LENGTH, CAR_WIDTH, WHEEL_RADIUS, buildCar, carPalette } from './car-model';
import { KADJAR_LENGTH, KADJAR_WIDTH, KADJAR_WHEEL_RADIUS, buildKadjar, kadjarPalette } from './kadjar-model';
import { DEFAULT_MODEL, type CarGear, type CarModelId } from '../car-spec';
import type { Part } from './mesh3d';

export interface CarModel {
  id: CarModelId;
  /** The make and the model, as said on screen. */
  name: string;
  /** The model alone, for a verb about it ("Back to the default Kadjar"). */
  short: string;
  /** The series and its years. */
  series: string;
  /** The footprint in model units — the shadow and the scale on the map read it. */
  length: number;
  width: number;
  wheelRadius: number;
  build(gear: CarGear): Part[];
  /** Its colours by role, given the author's body colour. */
  palette(bodyColor: string): Record<string, string>;
}

export const CAR_MODELS: readonly CarModel[] = [
  {
    id: 'prado-j120',
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
    name: 'Renault Kadjar',
    short: 'Kadjar',
    series: 'Phase 2 · 2018–2022',
    length: KADJAR_LENGTH,
    width: KADJAR_WIDTH,
    wheelRadius: KADJAR_WHEEL_RADIUS,
    build: buildKadjar,
    palette: kadjarPalette,
  },
];

/** The model an id names — the default car for one this build does not know. */
export function carModel(id: string): CarModel {
  return CAR_MODELS.find((model) => model.id === id) ?? CAR_MODELS.find((model) => model.id === DEFAULT_MODEL) ?? CAR_MODELS[0];
}
