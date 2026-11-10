/**
 * A RAW's SENSOR as an 8-bit picture, for every instrument that is not the
 * Develop tool (`sensor-outside-develop.md`) — Recap's print and export,
 * Trips' and the Studio's stage and export.
 *
 * It is nothing new: the recipe a roll's follower on `opensOn: 'sensor'`
 * leaves Develop with, run through the same pieces — the gain metered as the
 * stage meters it (`meterRaw`, held for the session), the camera profile
 * resolved by that decode, the develop it opens on (`openOnSensor`), the TOP
 * rung of the calibration its own file carries (a DJI DNG's gain map and
 * warp: without them the corners sit 2.5 stops low and the frame is 4.93 %
 * wider than the camera's), and `renderRollPicture`'s RAW path, so LibRaw,
 * its tiles, its bands and a phone's budgets are the decoder's own. No second
 * decoder, no second recipe.
 *
 * What comes back is the picture AS TAKEN, 8 bits, the way the camera's render
 * would have been handed over: the host's own develop, look and export run on
 * it unchanged, so its stage and its export agree by construction. Recovering
 * highlights in the sensor's range stays the Develop tool's.
 *
 * The last few made are held for the session (by file, size and edge) so a
 * stage that re-renders does not decode again.
 */

import { composeLutStack } from '../lut/lut-stack';
import { deviceClass } from '../lib/device-class';
import { rawDecodeEdge, type RawPurpose } from '../raw/raw-budget';
import { calibrationAt, readRawCalibration, topRung } from '../raw/calibration';
import { fileKey } from '../raw/decoded-cache';
import { maxRenderSize } from '../render/graph-grader';
import { meterRaw } from './roll-choice-source';
import { renderRollPicture } from './roll-render';
import { openOnSensor } from './raw-choice';
import type { DevelopBase } from './develop';

export interface SensorStill {
  /** The picture as taken, a JPEG of at most the asked long edge. */
  blob: Blob;
  width: number;
  height: number;
  /** The sensor's own pixels, as shown. */
  sensor: { width: number; height: number };
  /** The measured exposure it was brought to. */
  gain: number;
  /** The calibration applied: the top rung its file carries. */
  rung: DevelopBase;
}

export interface SensorStillOptions {
  /** The long edge wanted; the device's own ceiling for `purpose` and the GPU's cap bound it. */
  edge: number;
  /** A stage's print (`stage`) or a delivery (`export`) — which budget of `raw-budget.ts` applies. */
  purpose?: Exclude<RawPurpose, 'loupe'>;
  signal?: AbortSignal;
  /** JPEG quality, 0..1. */
  quality?: number;
}

const HELD = 6;
const held = new Map<string, Promise<SensorStill>>();

/** The long edge a sensor still is made at on this device for `edge` asked. */
export function sensorStillEdge(edge: number, purpose: Exclude<RawPurpose, 'loupe'> = 'stage'): number {
  return Math.max(1, Math.round(Math.min(edge, rawDecodeEdge(purpose, deviceClass(), maxRenderSize()))));
}

/** `file`'s sensor as an 8-bit picture of at most `edge` on its long side. */
export function sensorStill(file: File, opts: SensorStillOptions): Promise<SensorStill> {
  const purpose = opts.purpose ?? 'stage';
  const edge = sensorStillEdge(opts.edge, purpose);
  const key = `${fileKey(file)}|${edge}|${opts.quality ?? 0.92}`;
  const hit = held.get(key);
  if (hit) {
    held.delete(key);
    held.set(key, hit);
    return hit;
  }
  const made = makeSensorStill(file, edge, opts);
  held.set(key, made);
  // A failed or cancelled one is never held.
  made.catch(() => held.delete(key));
  while (held.size > HELD) held.delete(held.keys().next().value as string);
  return made;
}

/** Forget every sensor still held — the decoder's own cache is `dropDecodedRaws`'. */
export function dropSensorStills(): void {
  held.clear();
}

async function makeSensorStill(file: File, edge: number, opts: SensorStillOptions): Promise<SensorStill> {
  const metered = await meterRaw(file, opts.signal, 'resolve');
  const cal = await readRawCalibration(file);
  const rung = topRung(cal);
  const develop = { ...openOnSensor(null), base: rung, rawGain: metered.gain, ...(metered.profile ? { rawProfile: metered.profile } : {}) };
  const lut = composeLutStack([], 'none', 'tetrahedral', develop);
  const out = await renderRollPicture(file, {
    signal: opts.signal,
    framing: null,
    aspect: 'original',
    border: null,
    lut,
    targets: [{ size: { mode: 'long', value: edge }, quality: opts.quality ?? 0.92, sharpen: 'off', format: 'jpeg' }],
    raw: { file, gain: metered.gain, profile: metered.profile ?? null },
    // A still delivered whole is never cropped: its half-size decode is enough as soon as it holds the edge.
    rawMargin: 1,
    calibration: calibrationAt(rung, cal),
  });
  return {
    blob: out.blob,
    width: out.width,
    height: out.height,
    sensor: out.sensor ?? out.source,
    gain: metered.gain,
    rung,
  };
}
