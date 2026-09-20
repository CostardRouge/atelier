/**
 * WHAT A RAW'S OWN CALIBRATION MEANS TO A RENDER — the seam between the file
 * (`exif/dng-opcodes.ts`) and the two passes that apply it
 * (`render/gain-map.ts`, `render/camera-warp.ts`).
 *
 * It answers two questions and nothing else: which RUNGS of the material
 * ladder this file can offer, and what the passes need at the rung a picture
 * stands on. Read from a megabyte of the file's head, once per file, and held
 * for the session — the same shape as `sources/original-cache.ts`, for the
 * same reason: a stage that re-reads a header on every repaint is a stage
 * that stutters.
 *
 * **A rung is offered only where the file carries the opcode.** A DNG with no
 * GainMap simply has no `gainMap` rung, and nothing fabricates one — the rule
 * P6 shipped with no lens profiles for, applied to the case where the
 * measured data finally exists.
 */

import { probeRaw, sensorIfd, RAW_PROBE_BYTES } from '../exif/raw-probe';
import { describeOpcodes, isIdentityWarp, type DngOpcodes } from '../exif/dng-opcodes';
import { gainFieldFrom, isFlatField, maxGain, type GainField } from '../render/gain-map';
import { describeWarp, type CameraWarp } from '../render/camera-warp';
import { baseRung, type DevelopBase } from '../develop/develop';

/** A file's calibration, resolved into what the render graph can use. */
export interface RawCalibration {
  /** The shading grid over the whole image, or null when the file states none. */
  gain: GainField | null;
  /** The rectilinear warp, or null when the file states none (or an identity). */
  warp: CameraWarp | null;
  /** The sensor's own pixels — what the opcodes were written against. */
  width: number;
  height: number;
  /** What the file asks for, in the numbers a person can check. */
  summary: string;
}

/** What the passes want at a given rung — nothing at all below `gainMap`. */
export interface CalibrationAt {
  gain: GainField | null;
  warp: CameraWarp | null;
}

const NOTHING: CalibrationAt = { gain: null, warp: null };

/** Which rungs this file can honestly offer, lowest first. */
export function rungsFor(cal: RawCalibration | null | undefined): DevelopBase[] {
  const rungs: DevelopBase[] = ['proxy', 'gain'];
  if (cal?.gain) rungs.push('gainMap');
  if (cal?.gain && cal.warp) rungs.push('gainMapWarp');
  return rungs;
}

/**
 * The calibration to apply at one rung. `gainMap` adds the grid;
 * `gainMapWarp` adds the warp on top — so a rung always contains the one
 * below it, which is what makes the ladder a ladder.
 */
export function calibrationAt(
  base: DevelopBase | null | undefined,
  cal: RawCalibration | null | undefined,
): CalibrationAt {
  if (!cal) return NOTHING;
  const rung = baseRung(base);
  if (rung < baseRung('gainMap')) return NOTHING;
  return { gain: cal.gain, warp: rung >= baseRung('gainMapWarp') ? cal.warp : null };
}

/** The highest rung this file can reach — what an export climbs to. */
export function topRung(cal: RawCalibration | null | undefined): DevelopBase {
  const rungs = rungsFor(cal);
  return rungs[rungs.length - 1];
}

/** `gain map up to 5.93× · warp ×1.049`, or '' when the file asks for nothing. */
function summarise(opcodes: DngOpcodes, gain: GainField | null, warp: CameraWarp | null, w: number, h: number): string {
  const parts: string[] = [];
  if (gain) parts.push(`gain map up to ${maxGain(gain).toFixed(2)}×`);
  const warped = warp ? describeWarp(warp, w, h) : '';
  if (warped) parts.push(`warp ${warped}`);
  if (!parts.length) return describeOpcodes(opcodes);
  if (opcodes.unread.length) parts.push(`${opcodes.unread.length} not applied`);
  return parts.join(' · ');
}

const held = new Map<string, RawCalibration | null>();

function keyOf(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Read a RAW's calibration, once per file and per session.
 *
 * Null for a file that is not a RAW, carries no `OpcodeList3`, or states only
 * opcodes this engine does not apply — all three of which mean the same thing
 * to a caller: no rung above `gain`.
 */
export async function readRawCalibration(file: File): Promise<RawCalibration | null> {
  const key = keyOf(file);
  const known = held.get(key);
  if (known !== undefined) return known;
  let out: RawCalibration | null = null;
  try {
    const head = await file.slice(0, Math.min(RAW_PROBE_BYTES, file.size)).arrayBuffer();
    const probe = probeRaw(head);
    const opcodes = probe?.calibration ?? null;
    const sensor = probe ? sensorIfd(probe) : null;
    // The opcodes' rectangle is in the SENSOR's pixels, so without its size
    // there is nothing to normalise against and the grid cannot be laid over
    // the picture at all.
    const width = sensor?.width ?? 0;
    const height = sensor?.height ?? 0;
    if (opcodes && width > 0 && height > 0) {
      const field = gainFieldFrom(opcodes.gainMaps, width, height);
      const gain = field && !isFlatField(field) ? field : null;
      const warp = opcodes.warp && !isIdentityWarp(opcodes.warp) ? opcodes.warp : null;
      if (gain || warp) out = { gain, warp, width, height, summary: summarise(opcodes, gain, warp, width, height) };
    }
  } catch {
    out = null;
  }
  held.set(key, out);
  return out;
}

/** The calibration already read for this file, without waiting; undefined until it is. */
export function heldRawCalibration(file: File | null): RawCalibration | null | undefined {
  return file ? held.get(keyOf(file)) : null;
}
