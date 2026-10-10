/**
 * The arithmetic behind Develop's commands that write a PART of the develop
 * record — the curves, the levels, the colour mixer, black and white, the
 * grading wheels — and behind the commands that write a whole section record
 * (the perspective, the lens, detail, the vignette).
 *
 * The rule is the registry's: a value is REFUSED outside its range, never
 * clamped, and the refusal names the field and its range, so an agent learns
 * the shape from the answer instead of believing an impossible value landed.
 * Everything the command does not name is kept.
 *
 * Pure and DOM-free.
 */

import { CommandError, type CommandSpec } from '../commands/registry';
import {
  CURVE_CHANNELS,
  CURVE_MAX_POINTS,
  DEFAULT_CURVES,
  LEVELS_CHANNELS,
  MAX_LEVEL_GAMMA,
  MIN_LEVEL_GAMMA,
  NEUTRAL_LEVEL,
  cloneCurves,
  cloneLevels,
  curvesOrNull,
  levelsOrNull,
  type CurveChannel,
  type CurvePoint,
  type LevelChannel,
  type LevelsChannel,
} from './curves';
import { cloneDevelop, isDefaultDevelop, type DevelopSettings } from './develop';
import { GRADE_ZONES, cloneGrading, gradingOrNull, neutralGrading, type ColourGrading } from './grading';
import { DEFAULT_DETAIL, DETAIL_RANGES, detailOrNull, type DetailSettings } from '../render/detail';
import { DEFAULT_KEYSTONE, keystoneOrNull, type Keystone } from '../render/geometry';
import { DEFAULT_LENS, lensOrNull, type LensCorrection } from '../render/lens';
import { DEFAULT_POST_VIGNETTE, POST_VIGNETTE_RANGES, postVignetteOrNull, type PostCropVignette } from '../render/post-vignette';
import {
  MIXER_BANDS,
  MIXER_CHANNELS,
  cloneMixer,
  emptyMixer,
  mixerOrNull,
  straightMono,
  type MixerBand,
  type MixerChannel,
} from './mixer';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const invalid = (message: string) => new CommandError('invalid', message);

/** A number at `path`, inside [min, max] — else refused, naming both. */
export function numberIn(path: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(`${path} must be a finite number`);
  if (v < min || v > max) throw invalid(`${path} is ${v}, outside its range ${min}..${max}`);
  return v;
}

/** Only these keys, or refused naming the ones it takes. */
function onlyKeys(path: string, obj: Record<string, unknown>, keys: readonly string[]) {
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) throw invalid(`${path} has no "${k}" — it takes ${keys.join(', ')}`);
  }
}

function settled(next: DevelopSettings): DevelopSettings | null {
  return isDefaultDevelop(next) ? null : next;
}

// --- curves -------------------------------------------------------------------

/**
 * A curve as an agent writes it: points as `{x, y}` or `[x, y]`, both in
 * 0..1 (0 black, 1 white; x what comes in, y what goes out), in any order —
 * sorted here — at least two, at most `CURVE_MAX_POINTS`, no two on one x.
 */
export function readCurvePoints(path: string, raw: unknown): CurvePoint[] {
  if (!Array.isArray(raw)) throw invalid(`${path} must be a list of points, e.g. [[0,0],[0.25,0.2],[0.75,0.8],[1,1]]`);
  if (raw.length < 2) throw invalid(`${path} needs at least two points`);
  if (raw.length > CURVE_MAX_POINTS) throw invalid(`${path} has ${raw.length} points — at most ${CURVE_MAX_POINTS}`);
  const pts = raw.map((p, i) => {
    const [x, y] = Array.isArray(p) ? p : isRecord(p) ? [p.x, p.y] : [undefined, undefined];
    return { x: numberIn(`${path}[${i}].x`, x, 0, 1), y: numberIn(`${path}[${i}].y`, y, 0, 1) };
  });
  pts.sort((a, b) => a.x - b.x);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x === pts[i - 1].x) throw invalid(`${path} has two points at x = ${pts[i].x} — a curve takes one value per input`);
  }
  return pts;
}

/**
 * `d` with one tone curve set — or put back to the straight line with
 * `points: null`. `luma` shapes brightness and keeps colour; `rgb` and the
 * three channels shape the channels themselves, which is how a curve tints.
 */
export function withCurve(d: DevelopSettings | null | undefined, channel: string, points: unknown): DevelopSettings | null {
  if (!(CURVE_CHANNELS as readonly string[]).includes(channel)) {
    throw invalid(`no curve "${channel}" — the curves are ${CURVE_CHANNELS.join(', ')}`);
  }
  const next = cloneDevelop(d);
  const curves = cloneCurves(next.curves) ?? { ...DEFAULT_CURVES };
  curves[channel as CurveChannel] = points === null ? null : readCurvePoints('points', points);
  next.curves = curvesOrNull(curves);
  return settled(next);
}

// --- levels -------------------------------------------------------------------

const LEVEL_KEYS = ['inBlack', 'inWhite', 'gamma', 'outBlack', 'outWhite'] as const;

/**
 * `d` with one channel's levels patched — the fields named are written, the
 * rest kept — or put back to neutral with `patch: null`. Inputs and outputs
 * are 0..1, gamma 0.1..10 (1 is none; above 1 lightens the midtones), and the
 * input range must stay open (inWhite above inBlack).
 */
export function withLevels(d: DevelopSettings | null | undefined, channel: string, patch: unknown): DevelopSettings | null {
  if (!(LEVELS_CHANNELS as readonly string[]).includes(channel)) {
    throw invalid(`no levels channel "${channel}" — the channels are ${LEVELS_CHANNELS.join(', ')}`);
  }
  const next = cloneDevelop(d);
  const levels = cloneLevels(next.levels) ?? { rgb: null, red: null, green: null, blue: null };
  const ch = channel as LevelsChannel;
  if (patch === null) {
    levels[ch] = null;
  } else {
    if (!isRecord(patch)) throw invalid('the levels must be an object of inBlack, inWhite, gamma, outBlack, outWhite');
    onlyKeys('levels', patch, LEVEL_KEYS);
    const level: LevelChannel = { ...(levels[ch] ?? NEUTRAL_LEVEL) };
    for (const k of LEVEL_KEYS) {
      if (!(k in patch)) continue;
      level[k] = k === 'gamma' ? numberIn('gamma', patch[k], MIN_LEVEL_GAMMA, MAX_LEVEL_GAMMA) : numberIn(k, patch[k], 0, 1);
    }
    if (!(level.inWhite > level.inBlack)) {
      throw invalid(`inWhite (${level.inWhite}) must stay above inBlack (${level.inBlack})`);
    }
    levels[ch] = level;
  }
  next.levels = levelsOrNull(levels);
  return settled(next);
}

// --- the colour mixer and black and white -----------------------------------------

/** Band → value, each band one of the eight and each value in −100..100. */
function readBands(path: string, raw: unknown): Partial<Record<MixerBand, number>> {
  if (!isRecord(raw)) throw invalid(`${path} must be an object of band → value, e.g. {"blue": -30, "orange": 10}`);
  onlyKeys(path, raw, MIXER_BANDS);
  const out: Partial<Record<MixerBand, number>> = {};
  for (const [band, v] of Object.entries(raw)) out[band as MixerBand] = numberIn(`${path}.${band}`, v, -100, 100);
  return out;
}

/**
 * `d` with bands of one mixer channel set — hue (±100 is ±30°, half way to
 * the next band), saturation, or luminance (±100 is ±1.5 stops on a fully
 * coloured pixel). Bands not named keep their value.
 */
export function withMixer(d: DevelopSettings | null | undefined, channel: string, values: unknown): DevelopSettings | null {
  if (!(MIXER_CHANNELS as readonly string[]).includes(channel)) {
    throw invalid(`no mixer channel "${channel}" — the channels are ${MIXER_CHANNELS.join(', ')}`);
  }
  const bands = readBands('values', values);
  const next = cloneDevelop(d);
  const mixer = cloneMixer(next.mixer) ?? emptyMixer();
  for (const [band, v] of Object.entries(bands)) mixer[channel as MixerChannel][MIXER_BANDS.indexOf(band as MixerBand)] = v;
  next.mixer = mixerOrNull(mixer);
  return settled(next);
}

/**
 * `d` in black and white (`on: true`) with an optional mix — each band's
 * light in the grey, ±100 being ±1.5 stops, a red filter's worth — or back in
 * colour (`on: false`), the colour mixer found where it was left.
 */
export function withMono(d: DevelopSettings | null | undefined, on: boolean, mix: unknown): DevelopSettings | null {
  const next = cloneDevelop(d);
  if (!on) {
    if (mix !== undefined) throw invalid('"mix" only goes with on: true');
    next.mono = null;
    return settled(next);
  }
  const mono = next.mono ? { mix: [...next.mono.mix] } : straightMono();
  if (mix !== undefined) {
    for (const [band, v] of Object.entries(readBands('mix', mix))) mono.mix[MIXER_BANDS.indexOf(band as MixerBand)] = v;
  }
  next.mono = mono;
  return settled(next);
}

// --- colour grading -------------------------------------------------------------

/**
 * `d` with the grading wheels patched: any of `shadows`, `midtones`,
 * `highlights`, `global` as `{hue 0..360, saturation 0..100, luminance
 * −100..100}` (fields not named kept), `blending` 0..100, `balance` −100..100.
 * `null` puts every wheel back.
 */
export function withGrading(d: DevelopSettings | null | undefined, patch: unknown): DevelopSettings | null {
  const next = cloneDevelop(d);
  if (patch === null) {
    next.grading = null;
    return settled(next);
  }
  if (!isRecord(patch)) throw invalid('the grading must be an object of wheels, blending and balance');
  onlyKeys('grading', patch, [...GRADE_ZONES, 'blending', 'balance']);
  const g: ColourGrading = cloneGrading(next.grading) ?? neutralGrading();
  for (const zone of GRADE_ZONES) {
    const w = patch[zone];
    if (w === undefined) continue;
    if (!isRecord(w)) throw invalid(`${zone} must be an object of hue, saturation, luminance`);
    onlyKeys(zone, w, ['hue', 'saturation', 'luminance']);
    if ('hue' in w) g[zone].hue = numberIn(`${zone}.hue`, w.hue, 0, 360) % 360;
    if ('saturation' in w) g[zone].saturation = numberIn(`${zone}.saturation`, w.saturation, 0, 100);
    if ('luminance' in w) g[zone].luminance = numberIn(`${zone}.luminance`, w.luminance, -100, 100);
  }
  if ('blending' in patch) g.blending = numberIn('blending', patch.blending, 0, 100);
  if ('balance' in patch) g.balance = numberIn('balance', patch.balance, -100, 100);
  next.grading = gradingOrNull(g);
  return settled(next);
}

// --- whole section records --------------------------------------------------------

/**
 * A section record patched and read back through its OWN reader (the one a
 * stored roll goes through), with every field the patch named checked against
 * what the reader kept: a field the reader clamped or dropped is REFUSED,
 * naming what it reads back as. One rule for every record whose ranges live
 * in its reader rather than in a table — the perspective, the lens, detail,
 * the vignette — so no range is written twice.
 *
 * `null` puts the section back as shot.
 */
export function patchRecord<T extends object>(
  label: string,
  current: T | null | undefined,
  neutral: T,
  patch: unknown,
  read: (raw: unknown) => T | null,
): T | null {
  if (patch === null) return null;
  if (!isRecord(patch)) throw invalid(`${label} must be an object of its fields`);
  const base = (current ?? neutral) as Record<string, unknown>;
  const fields = Object.keys(neutral);
  onlyKeys(label, patch, fields);
  const merged = { ...base, ...patch };
  const out = read(merged);
  const kept = (out ?? neutral) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    const back = kept[k];
    const same = typeof v === 'number' && typeof back === 'number' ? Math.abs(v - back) <= 1e-9 : JSON.stringify(v) === JSON.stringify(back);
    if (!same) throw invalid(`${label}.${k} = ${JSON.stringify(v)} cannot be stored — it reads back as ${JSON.stringify(back)}`);
  }
  return out;
}

// --- the commands -----------------------------------------------------------------

/** Writes `change` of a picture's develop (the named one, else the open one) and answers the record after. */
export type DevelopWriter = (
  picture: unknown,
  change: (current: DevelopSettings | null) => DevelopSettings | null,
) => unknown;

const PICTURE = { type: 'string', description: 'A picture id; the open picture when absent.', optional: true } as const;

/**
 * The commands that write a PART of the develop record — registered by the
 * roll editor over its own writer, so every one is journaled as an agent's
 * and is one undo step like a slider.
 */
export function developRecordCommands(write: DevelopWriter): CommandSpec[] {
  return [
    {
      id: 'develop.curve',
      title: 'Set a tone curve',
      description:
        'Shape one tone curve with points in 0..1 (x what comes in, y what goes out; 0 black, 1 white), e.g. a gentle S: [[0,0],[0.25,0.2],[0.75,0.8],[1,1]]. Channels: luma (brightness only, colours kept), rgb (all three channels — adds contrast AND saturation), red, green, blue (tint). points: null puts the channel back straight. Other channels are kept.',
      params: {
        channel: { type: 'string', description: 'luma, rgb, red, green or blue.', enum: CURVE_CHANNELS },
        points: { type: 'array', description: 'Two to 32 points as [x, y] or {x, y}, any order; omit with reset: true.', optional: true },
        reset: { type: 'boolean', description: 'Put this channel back straight.', optional: true },
        picture: PICTURE,
      },
      run: (p) => {
        if (p.reset !== true && p.points === undefined) throw invalid('give "points", or reset: true');
        return write(p.picture, (d) => withCurve(d, p.channel as string, p.reset === true ? null : p.points));
      },
    },
    {
      id: 'develop.levels',
      title: 'Set levels',
      description:
        'Levels on one channel (rgb, red, green, blue): inBlack/inWhite (0..1, the input range stretched to full), gamma (0.1..10, above 1 lightens the midtones), outBlack/outWhite (0..1). Fields not named are kept; reset: true puts the channel back.',
      params: {
        channel: { type: 'string', description: 'rgb, red, green or blue.', enum: LEVELS_CHANNELS },
        values: { type: 'object', description: 'Any of inBlack, inWhite, gamma, outBlack, outWhite.', optional: true },
        reset: { type: 'boolean', description: 'Put this channel back to neutral.', optional: true },
        picture: PICTURE,
      },
      run: (p) => {
        if (p.reset !== true && p.values === undefined) throw invalid('give "values", or reset: true');
        return write(p.picture, (d) => withLevels(d, p.channel as string, p.reset === true ? null : p.values));
      },
    },
    {
      id: 'develop.mixer',
      title: 'Set the colour mixer (HSL)',
      description: `One channel of the colour mixer — hue (±100 = ±30°), saturation or luminance (±100 = ±1.5 stops on a fully coloured pixel) — for any of the eight bands ${MIXER_BANDS.join(', ')}, each −100..100. Bands not named are kept.`,
      params: {
        channel: { type: 'string', description: 'hue, saturation or luminance.', enum: MIXER_CHANNELS },
        values: { type: 'object', description: 'Band → value, e.g. {"blue": -30, "aqua": -20}.' },
        picture: PICTURE,
      },
      run: (p) => write(p.picture, (d) => withMixer(d, p.channel as string, p.values)),
    },
    {
      id: 'develop.bw',
      title: 'Black and white',
      description: `Turn the picture black and white (on: true) with an optional mix — each band's light in the grey, −100..100 (${MIXER_BANDS.join(', ')}; red +40 and blue −40 is a red filter's sky) — or back to colour (on: false), the colour mixer kept.`,
      params: {
        on: { type: 'boolean', description: 'true for black and white, false for colour.' },
        mix: { type: 'object', description: 'Band → light in the grey; only with on: true.', optional: true },
        picture: PICTURE,
      },
      run: (p) => write(p.picture, (d) => withMono(d, p.on === true, p.mix)),
    },
    {
      id: 'develop.grading',
      title: 'Colour grading wheels',
      description:
        'The grading wheels: shadows, midtones, highlights and global, each {hue 0..360, saturation 0..100, luminance −100..100}, plus blending 0..100 and balance −100..100 (positive favours the highlights). Fields not named are kept; reset: true puts every wheel back. A classic teal-and-orange: shadows {hue 200, saturation 25}, highlights {hue 35, saturation 20}.',
      params: {
        values: { type: 'object', description: 'Any of shadows, midtones, highlights, global, blending, balance.', optional: true },
        reset: { type: 'boolean', description: 'Put every wheel back.', optional: true },
        picture: PICTURE,
      },
      run: (p) => {
        if (p.reset !== true && p.values === undefined) throw invalid('give "values", or reset: true');
        return write(p.picture, (d) => withGrading(d, p.reset === true ? null : p.values));
      },
    },
  ];
}

/** The section records a command writes whole, by the roll's own field names. */
export interface SectionRecords {
  keystone: Keystone;
  lens: LensCorrection;
  detail: DetailSettings;
  vignette: PostCropVignette;
}
export type SectionKey = keyof SectionRecords;

/** Writes a picture's section record through `change` and answers the record after. */
export type SectionWriter = <K extends SectionKey>(
  picture: unknown,
  section: K,
  change: (current: SectionRecords[K] | null) => SectionRecords[K] | null,
) => unknown;

const ranges = (r: Readonly<Record<string, { min: number; max: number }>>) =>
  Object.entries(r)
    .map(([k, v]) => `${k} ${v.min}..${v.max}`)
    .join(', ');

/**
 * The commands that write a whole section record — perspective, lens,
 * detail, the post-crop vignette — each patched through `patchRecord` and its
 * own reader, so a clamped field is refused. A clip takes none of them (they
 * are passes over one still frame); the writer refuses it.
 */
export function sectionCommands(write: SectionWriter): CommandSpec[] {
  const values = (fields: string) => ({ type: 'object', description: `Any of: ${fields}.`, optional: true }) as const;
  const reset = { type: 'boolean', description: 'Put the section back as shot.', optional: true } as const;
  const spec = <K extends SectionKey>(
    id: string,
    title: string,
    section: K,
    neutral: SectionRecords[K],
    read: (raw: unknown) => SectionRecords[K] | null,
    fields: string,
    about: string,
  ): CommandSpec => ({
    id,
    title,
    description: `${about} Fields: ${fields}. Fields not named are kept; reset: true puts the section back. Not on a clip.`,
    params: { values: values(fields), reset, picture: PICTURE },
    run: (p) => {
      if (p.reset !== true && p.values === undefined) throw invalid('give "values", or reset: true');
      return write(p.picture, section, (cur) => patchRecord(section, cur, neutral, p.reset === true ? null : p.values, read));
    },
  });
  return [
    spec(
      'develop.perspective',
      'Perspective (keystone)',
      'keystone',
      DEFAULT_KEYSTONE,
      keystoneOrNull,
      'vertical −100..100 (above 0 widens the top: corrects a camera pointed UP), horizontal −100..100, rotation (degrees), aspect −100..100, scale (zoom to hide the corners)',
      'Correct converging lines. develop.auto with steps ["upright"] measures it from the picture.',
    ),
    spec(
      'develop.lens',
      'Lens correction (manual)',
      'lens',
      DEFAULT_LENS,
      lensOrNull,
      'distortion −100..100 (above 0 corrects barrel), distortion2 −100..100, chromaRed / chromaBlue −100..100 (lateral CA), vignette −100..100 (above 0 brightens the corners), vignetteMidpoint 0..100',
      'Undo what the lens did.',
    ),
    spec('develop.detail', 'Detail, noise, presence', 'detail', DEFAULT_DETAIL, detailOrNull, ranges(DETAIL_RANGES), 'Noise reduction (luminance, colour), defringe, sharpening (amount, radius in pixels, detail, masking) and presence (texture, clarity, dehaze).'),
    spec('develop.vignette', 'Post-crop vignette', 'vignette', DEFAULT_POST_VIGNETTE, postVignetteOrNull, ranges(POST_VIGNETTE_RANGES), 'A vignette drawn on the crop (amount below 0 darkens the edges).'),
  ];
}
