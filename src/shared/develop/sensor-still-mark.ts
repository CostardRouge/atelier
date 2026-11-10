/**
 * What a sensor still IS, remembered beside the `File` that carries it
 * (`sensor-still.ts`): the JPEG a host draws in place of a RAW on its sensor
 * says «JPEG» by its name and type, and the Develop sheet's fidelity chip
 * read exactly that — «JPEG · 8-bit» over a DNG's sensor, his report of
 * 2026-11-10. The chip asks here first (`picture-fidelity.ts`).
 *
 * A WeakMap, so a still let go is forgotten with it. Kept apart from the
 * brick, which pulls in the decoder, so the chip stays light.
 */

import type { DevelopBase } from './develop';

export interface SensorStillMark {
  /** The RAW it was read from. */
  raw: string;
  /** The sensor's own pixels, as shown. */
  sensor: { width: number; height: number };
  /** The calibration applied — the rung its file carries — when known (a kept print does not say). */
  rung: DevelopBase | null;
  /** A develop made in the Develop tool was rendered into it whole. */
  developed: boolean;
}

const marks = new WeakMap<File, SensorStillMark>();

export function markSensorStill(file: File, mark: SensorStillMark): File {
  marks.set(file, mark);
  return file;
}

export function sensorStillMark(file: File | null | undefined): SensorStillMark | null {
  return file ? (marks.get(file) ?? null) : null;
}
