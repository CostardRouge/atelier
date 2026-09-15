/**
 * The cars a trip may drive — one registry line per model, the way the tools
 * and the hook variants are listed.
 *
 * One entry today: the Toyota Land Cruiser Prado of the J120 series, built by
 * `car-model.ts`. A second car is a second `*-model.ts` over `mesh3d.ts` and
 * one line here; its parts must stay CONVEX, or the painter's ordering
 * breaks. Pure and DOM-free.
 */

import { CAR_LENGTH, CAR_WIDTH, WHEEL_RADIUS, buildCar } from './car-model';
import type { CarGear, CarModelId } from '../car-spec';
import type { Part } from './mesh3d';

export interface CarModel {
  id: CarModelId;
  /** The make and the model, as said on screen. */
  name: string;
  /** The series and its years. */
  series: string;
  /** The footprint in model units — the shadow and the scale on the map read it. */
  length: number;
  width: number;
  wheelRadius: number;
  build(gear: CarGear): Part[];
}

export const CAR_MODELS: readonly CarModel[] = [
  {
    id: 'prado-j120',
    name: 'Toyota Land Cruiser Prado',
    series: 'J120 · 2003–2009',
    length: CAR_LENGTH,
    width: CAR_WIDTH,
    wheelRadius: WHEEL_RADIUS,
    build: buildCar,
  },
];

/** The model an id names — the Prado for one this build does not know. */
export function carModel(id: string): CarModel {
  return CAR_MODELS.find((model) => model.id === id) ?? CAR_MODELS[0];
}
