/**
 * Which MATERIAL a RAW is read from outside the Develop tool — its camera
 * render (or a source's proxy) or its sensor — and the develop a picture is
 * put on its sensor with (`sensor-outside-develop.md`).
 *
 * Three rules, pure and DOM-free:
 *
 * - **A picture's own choice wins, then its document's, then Auto.** Both are
 *   ROLES, never files: the document's role is resolved per picture, so a
 *   picture added later follows it.
 * - **Auto never downloads.** It reads the sensor only where the RAW is the
 *   file in hand (a local file) and its camera render is under half the
 *   sensor's long edge — a DJI DNG's 960 × 540 against 8064 × 4536 goes to
 *   the sensor, a Sony ARW's 7008 × 4672 against 7040 × 4688 stays on its
 *   render. An instance's picture stays on its proxy until asked: its sensor
 *   is the whole original, 74 MB for a DJI DNG.
 * - **The rule speaks of the FILE, never of the place it fills**, so a
 *   picture keeps one material — one colour — at every size and in every
 *   instrument.
 *
 * `openOnSensor` is the develop a picture leaves on when it is put on its
 * sensor without numbers of its own: the gain rung (the export climbs to the
 * top rung its file carries), the gain metered afterwards, the curve the
 * stage opens it on. The Develop tool's roll export and the shared brick
 * (`sensor-still.ts`) both take it from here, so they cannot drift.
 */

import { openingBaseCurve } from './base-curve';
import { DEFAULT_DEVELOP, type DevelopSettings } from './develop';

export type RawMaterial = 'render' | 'sensor';

export const RAW_MATERIALS: readonly RawMaterial[] = ['render', 'sensor'];

/** Auto takes the sensor when the render's long edge is under this share of the sensor's. */
export const AUTO_RENDER_SHARE = 0.5;

export interface Size {
  width: number;
  height: number;
}

export interface AutoFacts {
  /** The RAW itself is the file in hand — no download to reach its sensor. */
  inHand: boolean;
  /** The sensor's long edge as shown, when known. */
  sensorEdge: number | null;
  /** The camera render's long edge, when known; 0 for a RAW that carries none. */
  renderEdge: number | null;
}

const longEdge = (s: Size | null | undefined): number | null => (s && s.width > 0 && s.height > 0 ? Math.max(s.width, s.height) : null);

/** The facts Auto reads, from the two sizes a RAW's head states (`rawSizes`). */
export function autoFactsOf(inHand: boolean, sizes: { sensor: Size | null; render: Size | null }): AutoFacts {
  return { inHand, sensorEdge: longEdge(sizes.sensor), renderEdge: sizes.render ? longEdge(sizes.render) : 0 };
}

/** What Auto answers for a RAW. Unknown sizes keep the render: nothing is decoded on a guess. */
export function autoMaterial(f: AutoFacts): RawMaterial {
  if (!f.inHand || !f.sensorEdge || f.renderEdge === null) return 'render';
  return f.renderEdge < f.sensorEdge * AUTO_RENDER_SHARE ? 'sensor' : 'render';
}

/** A stored material, or undefined for anything else. */
export function readMaterial(v: unknown): RawMaterial | undefined {
  return v === 'render' || v === 'sensor' ? v : undefined;
}

/** The material in force: the picture's own, else the document's, else Auto's. */
export function materialOf(own: RawMaterial | undefined | null, doc: RawMaterial | undefined | null, auto: RawMaterial): RawMaterial {
  return own ?? doc ?? auto;
}

/**
 * The develop a picture is put on its sensor with: its own numbers kept, the
 * base the gain rung with no gain yet (the decode meters it), the curve the
 * stage opens a sensor on (`openingBaseCurve`).
 */
export function openOnSensor(own: DevelopSettings | null | undefined): DevelopSettings {
  const from = own ?? DEFAULT_DEVELOP;
  return { ...from, base: 'gain', rawGain: null, baseCurve: openingBaseCurve(from.baseCurve) };
}
