/**
 * AUTO DETAIL — noise reduction and sharpening set from what the CAMERA said,
 * the way Lightroom and Capture One seed a picture's detail from its ISO and
 * its file kind before a hand touches it. Pure, DOM-free, tested.
 *
 * Two facts decide it, both read and never guessed:
 *
 * - the ISO, from the file's own EXIF (or the instance's vouched record): the
 *   noise a sensor leaves grows a stop at a time, so the luminance and the
 *   colour reduction grow per STOP above a floor, and the sharpen's masking
 *   with them — a high-ISO sky must not have its grain steepened;
 * - the MATERIAL the picture is developed from: a sensor demosaiced here is
 *   soft and takes the most sharpening, a camera's own JPEG was sharpened by
 *   the body already and takes less, and a proxy — a re-encode made to look
 *   at — takes none, which the told line says rather than hides.
 *
 * Every number is a TASTE constant, named here so it can be moved from the
 * maintainer's pictures rather than from an argument (`docs/auto-develop.md`
 * §8). The radius and the sharpen's Detail are left where they are: they
 * belong to the lens and the hand, not to the ISO. A file with no ISO gets
 * its sharpen alone and says so — nothing is written where nothing was
 * measured.
 */

import { DEFAULT_DETAIL, type DetailSettings } from '../render/detail';

/** Which bytes the picture is developed from — what decides its sharpening. */
export type DetailMaterial = 'sensor' | 'camera' | 'proxy';

export interface DetailFacts {
  /** The capture's ISO, or null when the file does not say. */
  iso: number | null;
  material: DetailMaterial;
}

/** Under this ISO the luminance is left alone; above it, each stop adds. */
export const NOISE_FROM_ISO = 800;
export const LUMINANCE_PER_STOP = 12;
/** Colour noise is there from a lower ISO, and the chroma blur costs no edge. */
export const COLOUR_FROM_ISO = 400;
export const COLOUR_PER_STOP = 10;
export const COLOUR_CAP = 80;
/** Past this the sharpen is held off the strong edges — where a high ISO's grain would be steepened. */
export const MASKING_PER_STOP = 12;
export const MASKING_CAP = 60;
/** The sharpen a material takes: a demosaiced sensor is soft, a body's JPEG is sharpened already, a proxy is for looking at. */
export const SHARPEN_BY_MATERIAL: Readonly<Record<DetailMaterial, number>> = Object.freeze({
  sensor: 35,
  camera: 20,
  proxy: 0,
});

/** What Auto detail wrote, and what it read to write it. */
export interface AutoDetail {
  luminance: number;
  colour: number;
  sharpen: number;
  sharpenMasking: number;
  /** Stops above `NOISE_FROM_ISO`, or null with no ISO. */
  stops: number | null;
  /** A reduction asked past its slider's end. */
  clamped: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function stopsAbove(iso: number, from: number): number {
  return Math.max(0, Math.log2(iso / from));
}

/** The four numbers for these facts. Always an answer: the sharpen is known from the material alone. */
export function autoDetail(facts: DetailFacts): AutoDetail {
  const sharpen = SHARPEN_BY_MATERIAL[facts.material];
  if (!(facts.iso !== null && facts.iso > 0)) {
    return { luminance: 0, colour: 0, sharpen, sharpenMasking: 0, stops: null, clamped: false };
  }
  const noiseStops = stopsAbove(facts.iso, NOISE_FROM_ISO);
  const colourStops = stopsAbove(facts.iso, COLOUR_FROM_ISO);
  const luminanceAsked = LUMINANCE_PER_STOP * noiseStops;
  const colourAsked = COLOUR_PER_STOP * colourStops;
  return {
    luminance: Math.round(clamp(luminanceAsked, 0, 100)),
    colour: Math.round(clamp(colourAsked, 0, COLOUR_CAP)),
    sharpen,
    sharpenMasking: Math.round(clamp(MASKING_PER_STOP * noiseStops, 0, MASKING_CAP)),
    stops: Math.round(noiseStops * 10) / 10,
    clamped: luminanceAsked > 100.5 || colourAsked > COLOUR_CAP + 0.5,
  };
}

/** The detail record with Auto's four numbers SET, the rest kept — the radius and the Detail are the hand's. */
export function withAutoDetail(detail: DetailSettings | null, auto: AutoDetail): DetailSettings {
  return {
    ...(detail ?? DEFAULT_DETAIL),
    luminance: auto.luminance,
    colour: auto.colour,
    sharpen: auto.sharpen,
    sharpenMasking: auto.sharpenMasking,
  };
}

/** What Auto detail did, for the line that reports it. */
export function describeAutoDetail(auto: AutoDetail, facts: DetailFacts): string {
  const parts: string[] = [];
  if (facts.iso !== null && facts.iso > 0) parts.push(`ISO ${Math.round(facts.iso)}`);
  else parts.push('no ISO in the file · noise left alone');
  if (auto.luminance || auto.colour) parts.push(`noise ${auto.luminance} · colour ${auto.colour}`);
  else if (facts.iso !== null && facts.iso > 0) parts.push('no noise to reduce');
  parts.push(auto.sharpen ? `sharpen ${auto.sharpen}` : `no sharpen on a proxy`);
  if (auto.sharpenMasking) parts.push(`masking ${auto.sharpenMasking}`);
  if (auto.clamped) parts.push('as far as the sliders reach');
  return parts.join(' · ');
}
