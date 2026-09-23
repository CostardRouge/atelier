/**
 * A CAMERA PLATE — a photograph's credit composed as a small typographic
 * object instead of one line: the facts the author picked (`camera-facts.ts`),
 * set in one of eight layouts, placed under a badge or in a cell of the frame.
 *
 * Built from ordinary `text` elements handed to `drawOverlays`, never drawn by
 * a renderer of its own: a plate is themed, animated, burnt into a clip and
 * exported exactly like every other word on a frame, and the preview and the
 * delivered file cannot disagree about it.
 *
 * ONE constraint shapes the whole module. An element knows its anchor but a
 * pure module cannot measure text, so any layout that sets things side by side
 * — a plate's columns, a ledger's label and value, a viewfinder's readout — is
 * set in JetBrains Mono, pinned against the theme, whose advance is exactly
 * 0.6 em for every glyph. Widths are then arithmetic rather than guesses, and
 * a column never runs into the next. A run that stands alone on its line (a
 * body name, an italic caption) keeps the theme's face and is placed by its
 * anchor, which needs no width at all.
 *
 * Geometry is in U — the plate's unit, a fraction of the frame's SHORTER side
 * (the size a text element's `sizeFrac` is measured in) — and converted to
 * frame fractions only when the elements are made, so one plate reads the same
 * on a 9:16 and a 4:5 frame.
 *
 * Pure and DOM-free.
 */

import type { Anchor, OverlayElement } from './overlay-types';
import { createTextElement } from './overlay-types';
import {
  CAMERA_FIELDS,
  LEGACY_CAMERA_FIELDS,
  isCameraField,
  isIdentityField,
  pickFacts,
  type CameraFact,
  type CameraFacts,
  type CameraField,
} from '../exif/camera-facts';

export type PlateLayout =
  | 'line'
  | 'tiers'
  | 'plate'
  | 'ledger'
  | 'caption'
  | 'viewfinder'
  | 'bar'
  | 'margin';

export const PLATE_LAYOUTS: readonly { id: PlateLayout; label: string; hint: string }[] = [
  { id: 'line', label: 'Line', hint: 'Every fact on one line, as the credit always read' },
  { id: 'tiers', label: 'Two tiers', hint: 'What took it in small capitals, the numbers under it' },
  { id: 'plate', label: 'Plate', hint: 'The numbers large, each over its own label' },
  { id: 'ledger', label: 'Ledger', hint: 'Label and value, row by row' },
  { id: 'caption', label: 'Caption', hint: 'An italic “Shot on…”, the numbers under it' },
  { id: 'viewfinder', label: 'Viewfinder', hint: 'The exposure as a camera shows it, with its meter' },
  { id: 'bar', label: 'Edge bar', hint: 'Across the top or bottom edge, what took it at one end' },
  { id: 'margin', label: 'Margin', hint: 'A column down the left or right edge' },
];

const LAYOUT_IDS = new Set<string>(PLATE_LAYOUTS.map((l) => l.id));

/** Under the badge's block, or in one cell of the frame's 3×3 grid. */
export type PlatePlace = 'badge' | Anchor;

const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** What the author chose. Stored; the facts it is filled with never are. */
export interface CameraPlateSpec {
  /** The facts shown, in the order they are read. */
  fields: CameraField[];
  layout: PlateLayout;
  place: PlatePlace;
  /** A multiple of the plate's own size, 0.6..1.8. */
  size: number;
}

export const MIN_PLATE_SIZE = 0.6;
export const MAX_PLATE_SIZE = 1.8;

/** What a credit that never chose draws: the legacy line, under the badge. */
export function defaultPlateSpec(): CameraPlateSpec {
  return { fields: [...LEGACY_CAMERA_FIELDS], layout: 'line', place: 'badge', size: 1 };
}

/** A stored spec read defensively — junk lands on the defaults, field by field. */
export function readPlateSpec(value: unknown): CameraPlateSpec {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<CameraPlateSpec>;
  const base = defaultPlateSpec();
  const fields = Array.isArray(v.fields) ? [...new Set(v.fields.filter(isCameraField))] : base.fields;
  const size =
    typeof v.size === 'number' && Number.isFinite(v.size)
      ? Math.min(MAX_PLATE_SIZE, Math.max(MIN_PLATE_SIZE, v.size))
      : base.size;
  return {
    fields,
    layout: typeof v.layout === 'string' && LAYOUT_IDS.has(v.layout) ? v.layout : base.layout,
    place:
      v.place === 'badge' || ANCHORS.includes(v.place as Anchor) ? (v.place as PlatePlace) : base.place,
    size,
  };
}

/**
 * The plate's words. English by default and every one editable on the trip,
 * like the badge's own: a plate is published copy.
 */
export interface CameraWords {
  /** What an italic caption opens with: "Shot on DJI Mini 4 Pro". */
  shotOn: string;
  /** Each fact's label, where a layout labels them. */
  tags: Record<CameraField, string>;
}

export const DEFAULT_CAMERA_WORDS: CameraWords = {
  shotOn: 'Shot on',
  tags: {
    body: 'Camera',
    lens: 'Lens',
    focal35: 'Focal',
    focal: 'Focal',
    aperture: 'Aperture',
    shutter: 'Shutter',
    iso: 'ISO',
    ev: 'EV',
    altitude: 'Height',
  },
};

export const FRENCH_CAMERA_WORDS: CameraWords = {
  shotOn: 'Pris au',
  tags: {
    body: 'Boîtier',
    lens: 'Objectif',
    focal35: 'Focale',
    focal: 'Focale',
    aperture: 'Ouverture',
    shutter: 'Vitesse',
    iso: 'ISO',
    ev: 'IL',
    altitude: 'Hauteur',
  },
};

/** Words read defensively: every missing or blank one is the English default. */
export function cameraWordsOf(words: Partial<CameraWords> | null | undefined): CameraWords {
  const tags = { ...DEFAULT_CAMERA_WORDS.tags };
  for (const f of CAMERA_FIELDS) {
    const t = words?.tags?.[f.id];
    if (typeof t === 'string' && t.trim()) tags[f.id] = t;
  }
  return {
    shotOn: typeof words?.shotOn === 'string' && words.shotOn.trim() ? words.shotOn : DEFAULT_CAMERA_WORDS.shotOn,
    tags,
  };
}

// ---------------------------------------------------------------------------
// Runs: the plate in U, before it is anywhere
// ---------------------------------------------------------------------------

/** One line of text in the plate. */
export interface PlateRun {
  text: string;
  /**
   * Horizontal position in U from the plate's REFERENCE — its left edge when
   * aligned left, its right edge when aligned right, its middle when centred.
   */
  x: number;
  /** Top of the run's box, in U from the plate's top. */
  y: number;
  /** The run's size in U (its `sizeFrac` is size × U). */
  size: number;
  /** Which side of the run `x` names. */
  align: 'left' | 'center' | 'right';
  /** `theme` follows the title style; `mono` and `serif` are pinned. */
  font: 'theme' | 'mono' | 'serif';
  italic?: boolean;
  letterSpacingEm?: number;
  /**
   * A position across the WHOLE frame, 0..1, overriding `x`: an edge bar puts
   * one run at each end of the frame, which no plate-relative x can say.
   */
  frameX?: number;
}

export interface PlateRuns {
  runs: PlateRun[];
  /** The plate's height in U. */
  height: number;
  /** Where it goes, once edges have had their say (a bar is never "under the badge"). */
  place: PlatePlace;
  /** A layout bound to an edge: the bar's top or bottom, the margin's side. */
  edge: 'top' | 'bottom' | 'left' | 'right' | null;
}

/** JetBrains Mono's advance: every glyph, 600 of 1000 units. */
export const MONO_ADVANCE = 0.6;

/**
 * A generous ESTIMATE of a proportional face's width in U — a little wider
 * than Space Grotesk's average glyph. Only ever used to decide whether two
 * things would meet, never to place a column: those are set in mono.
 */
export function approxWidth(text: string, size: number, letterSpacingEm = 0): number {
  return [...text].length * (0.6 + letterSpacingEm) * size;
}

/**
 * The plate's horizontal extent in U, about its reference: exact for mono
 * runs, estimated for the rest. For a preview to size itself by, never for
 * placing anything.
 */
export function plateSpan(plate: PlateRuns): number {
  let lo = 0;
  let hi = 0;
  for (const r of plate.runs) {
    if (r.frameX !== undefined) continue;
    const w =
      r.font === 'mono'
        ? monoWidth(r.text, r.size, r.letterSpacingEm ?? 0)
        : approxWidth(r.text, r.size, r.letterSpacingEm ?? 0);
    const a = r.align === 'left' ? r.x : r.align === 'right' ? r.x - w : r.x - w / 2;
    lo = Math.min(lo, a);
    hi = Math.max(hi, a + w);
  }
  return hi - lo;
}

/** The width in U of `text` set in mono at `size`, letter spacing included. */
export function monoWidth(text: string, size: number, letterSpacingEm = 0): number {
  return [...text].length * (MONO_ADVANCE + letterSpacingEm) * size;
}

/** The horizontal half of an anchor. */
export function columnOf(anchor: Anchor): 'left' | 'center' | 'right' {
  if (anchor.endsWith('-left')) return 'left';
  if (anchor.endsWith('-right')) return 'right';
  return 'center';
}

function rowOf(anchor: Anchor): 'top' | 'center' | 'bottom' {
  if (anchor.startsWith('top-')) return 'top';
  if (anchor.startsWith('bottom-')) return 'bottom';
  return 'center';
}

/** `value` in capitals, for the runs a layout sets in small capitals. */
function caps(text: string): string {
  return text.toLocaleUpperCase();
}

/** Shift runs laid out from a left edge onto the alignment's reference. */
function realign(runs: PlateRun[], width: number, align: 'left' | 'center' | 'right'): PlateRun[] {
  if (align === 'left') return runs;
  const shift = align === 'right' ? -width : -width / 2;
  return runs.map((r) => ({ ...r, x: r.x + shift }));
}

/** A fact as a viewfinder shows it: `F1.7`, `ISO100`, `1/240`. */
function readout(f: CameraFact): string {
  if (f.field === 'aperture') return `F${f.value.replace(/^ƒ\//, '')}`;
  if (f.field === 'iso') return `ISO${f.bare}`;
  return f.value.replace(/ /g, '');
}

/** The meter's ticks: −2 to +2 EV in thirds, whole stops marked. */
const METER_TICKS = 13;

/**
 * The runs of `layout` for the facts in hand, or null when none of the chosen
 * fields is recorded — the credit is then ABSENT, never a blank plate.
 *
 * `align` is the side a plate hangs from: the badge's own column when under
 * it, the cell's column in the grid. An edge layout decides its own.
 */
export function plateRuns(
  facts: CameraFacts,
  spec: CameraPlateSpec,
  words: CameraWords,
  align: 'left' | 'center' | 'right',
  /**
   * The frame's width in U, when known — what an edge bar has to fit its two
   * ends into. Absent, the bar assumes they fit.
   */
  frameWidth?: number,
): PlateRuns | null {
  const picked = pickFacts(facts, spec.fields);
  const meterWanted = spec.layout === 'viewfinder' && spec.fields.includes('ev') && facts.evStops !== null;
  if (picked.length === 0 && !meterWanted) return null;
  const ids = picked.filter((f) => isIdentityField(f.field));
  const nums = picked.filter((f) => !isIdentityField(f.field));
  const tag = (f: CameraFact) => caps(words.tags[f.field]);
  const place = spec.place;

  switch (spec.layout) {
    case 'line': {
      const text = picked.map((f) => f.value).join(' · ');
      return { runs: [{ text, x: 0, y: 0, size: 1, align, font: 'theme' }], height: 1, place, edge: null };
    }

    case 'tiers': {
      const runs: PlateRun[] = [];
      let y = 0;
      if (ids.length) {
        runs.push({
          text: caps(ids.map((f) => f.value).join('  —  ')),
          x: 0,
          y,
          size: 0.8,
          align,
          font: 'theme',
          letterSpacingEm: 0.12,
        });
        y += 0.8 + 0.5;
      }
      if (nums.length) {
        runs.push({ text: nums.map((f) => f.value).join('   '), x: 0, y, size: 1, align, font: 'mono', letterSpacingEm: 0 });
        y += 1;
      } else {
        y -= 0.5;
      }
      return { runs, height: y, place, edge: null };
    }

    case 'plate': {
      const runs: PlateRun[] = [];
      let y = 0;
      if (ids.length) {
        runs.push({
          text: caps(ids.map((f) => f.value).join(' · ')),
          x: 0,
          y,
          size: 0.72,
          align,
          font: 'theme',
          letterSpacingEm: 0.14,
        });
        y += 0.72 + 0.7;
      }
      if (!nums.length) return { runs, height: Math.max(0, y - 0.7), place, edge: null };
      const cells: PlateRun[] = [];
      let x = 0;
      const gap = 1.3;
      nums.forEach((f, i) => {
        const value = f.field === 'iso' || f.field === 'ev' ? f.bare : f.value;
        const label = tag(f);
        const w = Math.max(monoWidth(value, 1.5), monoWidth(label, 0.5, 0.12));
        cells.push({ text: value, x, y, size: 1.5, align: 'left', font: 'mono', letterSpacingEm: 0 });
        cells.push({ text: label, x, y: y + 1.5 + 0.4, size: 0.5, align: 'left', font: 'mono', letterSpacingEm: 0.12 });
        x += w + (i < nums.length - 1 ? gap : 0);
      });
      runs.push(...realign(cells, x, align));
      return { runs, height: y + 1.5 + 0.4 + 0.5, place, edge: null };
    }

    case 'ledger': {
      const rows = picked.map((f) => ({ label: tag(f), value: f.value }));
      const labelW = Math.max(...rows.map((r) => monoWidth(r.label, 0.58, 0.12)));
      const valueW = Math.max(...rows.map((r) => monoWidth(r.value, 0.95)));
      const gap = 1.4;
      const width = labelW + gap + valueW;
      const pitch = 1.45;
      const runs: PlateRun[] = [];
      rows.forEach((r, i) => {
        const top = i * pitch;
        // Tops offset so the two faces sit on one baseline: a cap is ~0.73 em.
        runs.push({ text: r.label, x: 0, y: top + (0.95 - 0.58) * 0.73, size: 0.58, align: 'left', font: 'mono', letterSpacingEm: 0.12 });
        runs.push({ text: r.value, x: width, y: top, size: 0.95, align: 'right', font: 'mono', letterSpacingEm: 0 });
      });
      return { runs: realign(runs, width, align), height: rows.length * pitch - (pitch - 0.95), place, edge: null };
    }

    case 'caption': {
      const runs: PlateRun[] = [];
      let y = 0;
      const body = ids.find((f) => f.field === 'body');
      const lens = ids.find((f) => f.field === 'lens');
      const head = body
        ? `${words.shotOn.trim()} ${body.value}${lens ? `, ${lens.value}` : ''}`.trim()
        : (lens?.value ?? '');
      if (head) {
        runs.push({ text: head, x: 0, y, size: 1.5, align, font: 'serif', italic: true });
        y += 1.5 + 0.45;
      }
      if (nums.length) {
        runs.push({
          text: nums.map((f) => f.value).join('  ·  '),
          x: 0,
          y,
          size: 0.7,
          align,
          font: 'mono',
          letterSpacingEm: 0.04,
        });
        y += 0.7;
      } else if (head) {
        y -= 0.45;
      }
      return { runs, height: y, place, edge: null };
    }

    case 'viewfinder': {
      // A viewfinder shows the exposure, not the name of the camera it is in.
      const shown = nums.filter((f) => f.field !== 'ev').map(readout);
      const gap = 1.6;
      const runs: PlateRun[] = [];
      let x = 0;
      shown.forEach((text, i) => {
        runs.push({ text, x, y: 0, size: 1, align: 'left', font: 'mono', letterSpacingEm: 0.04 });
        x += monoWidth(text, 1, 0.04) + (i < shown.length - 1 ? gap : 0);
      });
      let height = shown.length ? 1 : 0;
      if (meterWanted) {
        if (shown.length) x += gap;
        const ticks = Array.from({ length: METER_TICKS }, (_, i) => (i % 3 === 0 ? '|' : '·')).join('');
        const scale = `−${ticks}+`;
        const k = 0.8;
        runs.push({ text: scale, x, y: 0.1, size: k, align: 'left', font: 'mono', letterSpacingEm: 0 });
        const stops = Math.max(-2, Math.min(2, facts.evStops ?? 0));
        const tick = Math.round((stops + 2) * 3);
        // Under its tick: the scale's first glyph is the minus, then the ticks.
        const at = x + (1 + tick + 0.5) * MONO_ADVANCE * k;
        runs.push({ text: '▲', x: at, y: 0.1 + k * 0.85, size: 0.55, align: 'center', font: 'mono', letterSpacingEm: 0 });
        x += monoWidth(scale, k);
        height = Math.max(height, 0.1 + k * 0.85 + 0.55);
      }
      return { runs: realign(runs, x, align), height, place, edge: null };
    }

    case 'bar': {
      // Across a whole edge: what took it at the start, the numbers at the end.
      const top = place !== 'badge' && rowOf(place) === 'top';
      const left = ids.map((f) => f.value).join('  ·  ');
      const right = nums.map((f) => f.value).join('   ');
      // Two ends of one line, unless they would meet: the frame is measured,
      // the theme's face estimated generously, and a bar that cannot hold
      // both on one line sets them on two rather than letting them collide.
      const room = frameWidth === undefined ? Infinity : frameWidth * (1 - 2 * BAR_INSET);
      const need =
        (left ? approxWidth(left, 1) : 0) + (right ? monoWidth(right, 0.9, 0.02) : 0) + (left && right ? 2 : 0);
      const stacked = need > room;
      const runs: PlateRun[] = [];
      if (left) {
        runs.push({ text: left, x: 0, y: 0, size: 1, align: 'left', font: 'theme', frameX: BAR_INSET });
      }
      if (right) {
        runs.push({
          text: right,
          x: 0,
          y: stacked && left ? 1.45 : 0.08,
          size: 0.9,
          align: stacked && left ? 'left' : 'right',
          font: 'mono',
          letterSpacingEm: 0.02,
          frameX: stacked && left ? BAR_INSET : 1 - BAR_INSET,
        });
      }
      const height = stacked && left && right ? 1.45 + 0.9 : 1;
      return { runs, height, place: top ? 'top-center' : 'bottom-center', edge: top ? 'top' : 'bottom' };
    }

    case 'margin': {
      // A column down one side: left if the cell says so, the right otherwise.
      const side = place !== 'badge' && columnOf(place) === 'left' ? 'left' : 'right';
      const a = side;
      const runs: PlateRun[] = [];
      let y = 0;
      for (const f of ids) {
        runs.push({ text: caps(f.value), x: 0, y, size: 0.62, align: a, font: 'theme', letterSpacingEm: 0.12 });
        y += 0.62 + 0.45;
      }
      if (ids.length && nums.length) y += 0.35;
      for (const f of nums) {
        runs.push({ text: tag(f), x: 0, y, size: 0.48, align: a, font: 'mono', letterSpacingEm: 0.14 });
        runs.push({
          text: f.field === 'iso' || f.field === 'ev' ? f.bare : f.value,
          x: 0,
          y: y + 0.48 + 0.3,
          size: 1,
          align: a,
          font: 'mono',
          letterSpacingEm: 0,
        });
        y += 0.48 + 0.3 + 1 + 0.6;
      }
      const height = Math.max(0, y - (nums.length ? 0.6 : 0.45));
      const row = place === 'badge' ? 'center' : rowOf(place);
      const cell: Anchor = row === 'center' ? `center-${side}` : `${row}-${side}`;
      return { runs, height, place: cell, edge: side };
    }
  }
}

/** How far an edge bar sits in from the frame's sides, as a fraction of the width. */
const BAR_INSET = 0.05;

// ---------------------------------------------------------------------------
// Elements: the plate somewhere on a frame
// ---------------------------------------------------------------------------

/** A length in U of the shorter side, as a fraction of the frame's WIDTH. */
function widthFraction(u: number, aspect: number): number {
  return u * Math.min(1, 1 / aspect);
}

/** A length in U of the shorter side, as a fraction of the frame's HEIGHT. */
export function heightFraction(u: number, aspect: number): number {
  return u * Math.min(1, aspect);
}

/**
 * Where a plate placed in a GRID cell hangs from: the reference x of its
 * column (the badge grid's own insets) and its top, in frame fractions.
 */
export function gridOrigin(
  plate: PlateRuns,
  unit: number,
  aspect: number,
): { x: number; top: number; align: 'left' | 'center' | 'right' } {
  const cell: Anchor = plate.place === 'badge' ? 'bottom-right' : plate.place;
  const h = heightFraction(plate.height * unit, aspect);
  const edgeInset = plate.edge ? 0.045 : 0;
  const col = columnOf(cell);
  const x = col === 'left' ? 0.07 - edgeInset : col === 'right' ? 0.93 + edgeInset : 0.5;
  const row = rowOf(cell);
  const top = row === 'top' ? 0.08 - edgeInset : row === 'bottom' ? 0.92 + edgeInset - h : 0.5 - h / 2;
  return { x, top, align: col };
}

/** The element id of a plate's `i`-th run under `baseId` — the first keeps the id itself. */
export function plateRunId(baseId: string, i: number): string {
  return i === 0 ? baseId : `${baseId}:${i}`;
}

/**
 * The plate's elements, hung from `origin` (its reference x and its top, in
 * frame fractions). `unit` is U as a fraction of the shorter side. Mono and
 * serif runs pin their face (and the mono ones their letter spacing, which
 * the widths depend on) so a title style cannot break a column.
 */
export function plateElements(
  plate: PlateRuns,
  origin: { x: number; top: number },
  unit: number,
  aspect: number,
  baseId: string,
): OverlayElement[] {
  return plate.runs.map((run, i) => {
    const el = createTextElement(run.text);
    el.id = plateRunId(baseId, i);
    el.anchor = `top-${run.align}` as Anchor;
    el.x = run.frameX ?? origin.x + widthFraction(run.x * unit, aspect);
    el.y = origin.top + heightFraction(run.y * unit, aspect);
    el.sizeFrac = run.size * unit;
    const pins: string[] = [];
    if (run.font === 'mono') {
      el.fontFamily = 'JetBrains Mono';
      pins.push('fontFamily');
    } else if (run.font === 'serif') {
      el.fontFamily = 'Instrument Serif';
      el.weight = 400;
      pins.push('fontFamily', 'weight');
    }
    if (run.italic) {
      el.italic = true;
      pins.push('italic');
    }
    if (run.letterSpacingEm !== undefined) {
      el.letterSpacingEm = run.letterSpacingEm;
      pins.push('letterSpacing');
    }
    el.styleOverrides = pins;
    return el;
  });
}
