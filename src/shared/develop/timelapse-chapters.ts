/**
 * A picture's journal read as CHAPTERS — what the making-of video shows
 * (`docs/develop-timelapse.md` §3.2).
 *
 * A step is a write; a chapter is a TOOL: consecutive steps touching the same
 * sections the same way fold into one, so five nudges of the exposure read
 * *+0.7 EV* and not five cards. Each chapter carries the picture BEFORE and
 * AFTER it — whole `RollPicture` states, folded from the picture as shot, so
 * the painter renders N + 1 states and never re-derives one — a caption that
 * says the DIFFERENCE (the sliders that moved, never the whole record), a
 * weight (what a viewer wants to see longest), and the REGION the step's own
 * geometry names: a heal's discs, a mask's box. The camera is read in the
 * step, never invented: a global slider shows the whole picture.
 *
 * A video keeps at most `keepCount(seconds)` chapters: the lightest by weight
 * FOLD into the chapter that follows them (or the last one), whose transition
 * then carries their change too, said in its caption. The state fold is
 * chronological, so a folded chapter still happens on the picture — it just
 * gets no card.
 *
 * Pure and DOM-free.
 */

import { describeFilmTexture, isSilentTexture } from '../film/film-texture';
import { OUTPUT_TRANSFORM_OPTIONS } from '../lut/transfer';
import { isDefaultFraming, type Framing } from '../media/framing';
import { describeDetail, isDefaultDetail, type DetailSettings } from '../render/detail';
import { describeKeystone, isDefaultKeystone, type Keystone } from '../render/geometry';
import { describeLens, isDefaultLens, type LensCorrection } from '../render/lens';
import type { Mask } from '../render/mask';
import { describePostVignette, isDefaultPostVignette, type PostCropVignette } from '../render/post-vignette';
import type { Patch } from '../render/repair';
import { describeAspect, freeAspectRatio } from './crop-aspect';
import { DEVELOP_KEYS, developLines, isDefaultDevelop, signed, type DevelopSettings } from './develop';
import { asShot, pictureJournal, sectionsChanged, withSectionValues } from './journal';
import { layerLabel, type AdjustLayer } from './layer';
import { PICTURE_SECTIONS } from './picture-sections';
import { PICTURE_EDITS, type JournalVia, type PictureEdit, type RollGrade, type RollPicture } from './roll-types';
import type { RollBorder } from './border-layout';

/** A box in the picture's own [0,1] × [0,1] frame — the top-left corner and the size. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the video looks: a centre in picture fractions and a zoom about it, 1 being the whole picture. */
export interface Camera {
  cx: number;
  cy: number;
  z: number;
}

export const WHOLE_PICTURE: Readonly<Camera> = Object.freeze({ cx: 0.5, cy: 0.5, z: 1 });

export interface Chapter {
  /** Stable while the journal keeps its steps: the first step's time. */
  id: string;
  /** The leading section — the heaviest of `sections`. */
  section: PictureEdit;
  sections: PictureEdit[];
  /** The picture before this chapter's first step. */
  before: RollPicture;
  /** The picture after its last step — and after what it absorbed. */
  after: RollPicture;
  /** What changed, said as a difference. */
  caption: string;
  via: JournalVia | null;
  /** How long a viewer wants to see it, relative to the others. */
  weight: number;
  /** The sections of the chapters folded into this one, in order. */
  absorbed: PictureEdit[];
  /** Where the step happened, or null for the whole picture. */
  region: Region | null;
  at: number;
}

/**
 * What a viewer wants to see longest: a crop, a mask or a heal is a GESTURE
 * on the picture, a look changes everything at once, a slider is a number.
 */
export const SECTION_WEIGHT: Readonly<Record<PictureEdit, number>> = Object.freeze({
  crop: 1.4,
  layers: 1.4,
  repair: 1.2,
  look: 1.2,
  develop: 1,
  perspective: 0.8,
  lens: 0.5,
  detail: 0.5,
  vignette: 0.5,
  border: 0.5,
});

/** How far a close-up goes: enough to see a spot, not enough to see pixels. */
export const CAMERA_MAX_ZOOM = 3;
/** The share of the frame a region is zoomed to fill. */
export const CAMERA_FILL = 0.6;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function sectionLabel(s: PictureEdit): string {
  return PICTURE_SECTIONS.find((x) => x.id === s)?.label ?? s;
}

// --- the captions: a DIFFERENCE, never the whole record ----------------------

const SLIDER_LABEL: Readonly<Record<(typeof DEVELOP_KEYS)[number], string>> = {
  exposure: '',
  brightness: 'brightness',
  contrast: 'contrast',
  highlights: 'highlights',
  shadows: 'shadows',
  whites: 'whites',
  blacks: 'blacks',
  temperature: 'temperature',
  tint: 'tint',
  saturation: 'saturation',
  vibrance: 'vibrance',
};

/** A slider's own line in `developLines`: `highlights −40`, `+0.7 EV` — never the RAW line, which ends in `metered`. */
const SLIDER_LINE = /^(?:(?:brightness|contrast|highlights|shadows|whites|blacks|temperature|tint|saturation|vibrance) [+−]\d|[+−]\d[\d.]* EV$)/;

/** The develop's difference: the sliders that moved, then every other fact that is new. */
export function describeDevelopChange(before: DevelopSettings | null, after: DevelopSettings | null): string {
  if (isDefaultDevelop(after)) return isDefaultDevelop(before) ? 'As shot' : 'Back to as shot';
  const a = after!;
  const parts: string[] = [];
  for (const k of DEVELOP_KEYS) {
    const was = before?.[k] ?? 0;
    const now = a[k] ?? 0;
    if (was === now) continue;
    if (k === 'exposure') parts.push(`${signed(now, 2).replace(/\.?0+$/, '')} EV`);
    else parts.push(`${SLIDER_LABEL[k]} ${signed(now)}`);
  }
  const wasLines = new Set(developLines(before));
  for (const line of developLines(a)) {
    // A slider's own line was said above with its sign; what is left is a
    // shape (a curve, the mixer, grading, levels, the RAW material).
    if (wasLines.has(line) || SLIDER_LINE.test(line)) continue;
    parts.push(line);
  }
  return parts.length ? parts.join(' · ') : 'Develop';
}

function outputLabel(id: string): string | null {
  const t = OUTPUT_TRANSFORM_OPTIONS.find((o) => o.id === id);
  return t && id !== 'none' ? t.label : null;
}

/** `Portra 400 · 80 %`, `Kodak 2383 + Bleach · 60 %`, `grain 30 %` — or `No look`. */
export function describeLook(grade: RollGrade | null | undefined): string {
  if (!grade) return 'No look';
  const layers = grade.layers.filter((l) => l.enabled);
  const parts: string[] = [];
  if (layers.length) {
    const named = layers.map((l) => {
      const pct = Math.round(l.intensity * 100);
      return pct === 100 ? l.name : `${l.name} · ${pct} %`;
    });
    parts.push(named.join(' + '));
  }
  const output = outputLabel(grade.output);
  if (output) parts.push(output);
  if (!isSilentTexture(grade.film)) parts.push(describeFilmTexture(grade.film));
  return parts.length ? parts.join(' · ') : 'No look';
}

function aspectWord(aspect: string): string | null {
  if (aspect === 'original') return null;
  const free = freeAspectRatio(aspect);
  return free !== null ? describeAspect(free) : aspect;
}

/** `Crop 4:5`, `Crop 4:5 · straighten −2.0°`, `Straighten +1.5°`, `Flipped`, `Crop off`. */
export function describeCropChange(
  before: { aspect: string; framing: Framing | null },
  after: { aspect: string; framing: Framing | null },
): string {
  const parts: string[] = [];
  const word = aspectWord(after.aspect);
  const f = after.framing && !isDefaultFraming(after.framing) ? after.framing : null;
  const was = before.framing && !isDefaultFraming(before.framing) ? before.framing : null;
  if (after.aspect !== before.aspect && word) parts.push(`Crop ${word}`);
  else if (word || f) parts.push('Crop');
  if (f) {
    const rot = f.rotation;
    const prevRot = was?.rotation ?? 0;
    if (rot !== prevRot) {
      const quarter = Math.round(rot / 90) * 90;
      const fine = rot - quarter;
      if (quarter) parts.push(`turned ${signed(quarter)}°`);
      if (Math.abs(fine) >= 0.05) parts.push(`straighten ${signed(fine, 1)}°`);
    }
    if ((f.flipX && !was?.flipX) || (f.flipY && !was?.flipY)) parts.push('flipped');
    if (Math.abs(f.scale - (was?.scale ?? 1)) > 0.005 && f.scale > 1.005) parts.push(`zoom ${f.scale.toFixed(2)}×`);
  }
  if (parts.length === 0) return word || f ? 'Crop' : 'Crop off';
  return parts.join(' · ');
}

function describeBorder(b: RollBorder | null | undefined): string {
  if (!b) return 'Border off';
  const fill = b.fill === 'blur' ? 'blur' : b.fill;
  const m = Math.round(Math.max(b.margin.x, b.margin.y) * 100);
  return `Border ${fill}${m ? ` · ${m} %` : ''}${b.aspect ? ` · ${b.aspect}` : ''}`;
}

/** The numbers of a flat record that differ, each said with its value after. */
function numericDiff<T extends object>(before: T | null, after: T, labels: Partial<Record<keyof T, string>>, unit: Partial<Record<keyof T, string>> = {}): string[] {
  const out: string[] = [];
  for (const key of Object.keys(labels) as (keyof T)[]) {
    const now = after[key];
    const was = before?.[key];
    if (typeof now !== 'number' || now === was) continue;
    if (was === undefined && now === 0) continue;
    out.push(`${labels[key]} ${signed(now)}${unit[key] ?? ''}`);
  }
  return out;
}

function describeDetailChange(before: DetailSettings | null, after: DetailSettings | null): string {
  if (isDefaultDetail(after)) return 'Detail off';
  const parts = numericDiff(before, after!, {
    dehaze: 'dehaze',
    clarity: 'clarity',
    texture: 'texture',
    luminance: 'denoise',
    colour: 'colour noise',
    defringe: 'defringe',
    sharpen: 'sharpen',
  });
  return parts.length ? parts.join(' · ') : describeDetail(after) || 'Detail';
}

function describeKeystoneChange(before: Keystone | null, after: Keystone | null): string {
  if (isDefaultKeystone(after)) return 'Keystone off';
  const parts = numericDiff(before, after!, { vertical: 'vertical', horizontal: 'horizontal', rotation: 'rotation', aspect: 'aspect' }, { rotation: '°' });
  return parts.length ? `Keystone · ${parts.join(' · ')}` : `Keystone · ${describeKeystone(after)}`;
}

function describeLensChange(before: LensCorrection | null, after: LensCorrection | null): string {
  if (isDefaultLens(after)) return 'Lens off';
  const parts = numericDiff(before, after!, {
    distortion: 'distortion',
    distortion2: 'k2',
    chromaRed: 'CA red',
    chromaBlue: 'CA blue',
    vignette: 'vignette',
  });
  return parts.length ? `Lens · ${parts.join(' · ')}` : `Lens · ${describeLens(after)}`;
}

function describeVignetteChange(after: PostCropVignette | null): string {
  if (isDefaultPostVignette(after)) return 'Vignette off';
  return describePostVignette(after).replace(/^vignette/, 'Vignette');
}

/** `Heal ×3 · Clone ×1` — what the picture carries after the step. */
export function describeRepair(after: readonly Patch[]): string {
  if (after.length === 0) return 'Repair cleared';
  const healed = after.filter((p) => p.kind === 'heal').length;
  const cloned = after.length - healed;
  const parts: string[] = [];
  if (healed) parts.push(`Heal ×${healed}`);
  if (cloned) parts.push(`Clone ×${cloned}`);
  return parts.join(' · ');
}

/** The layers this step added or changed, by id and value. */
function changedLayers(before: readonly AdjustLayer[], after: readonly AdjustLayer[]): AdjustLayer[] {
  const was = new Map(before.map((l) => [l.id, JSON.stringify(l)] as const));
  return after.filter((l) => was.get(l.id) !== JSON.stringify(l));
}

function describeLayersChange(before: readonly AdjustLayer[], after: readonly AdjustLayer[]): string {
  if (after.length === 0) return before.length ? 'Layers cleared' : 'Layers';
  const changed = changedLayers(before, after);
  const list = changed.length ? changed : after;
  const said = list.slice(0, 2).map((l) => {
    const line = developLines(l.develop);
    const what = line[0] === 'As shot' ? '' : ` · ${line[0]}`;
    return `${capitalise(layerLabel(l, after))}${what}`;
  });
  const more = list.length - said.length;
  if (changed.length === 0 && after.length < before.length) return 'Layer removed';
  return `${said.join(' · ')}${more > 0 ? ` · +${more}` : ''}`;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** One section's change between two states of the picture. */
export function describeChange(section: PictureEdit, before: RollPicture, after: RollPicture): string {
  switch (section) {
    case 'develop':
      return describeDevelopChange(before.develop, after.develop);
    case 'look':
      return describeLook(after.grade);
    case 'crop':
      return describeCropChange(
        { aspect: before.aspect, framing: before.framing },
        { aspect: after.aspect, framing: after.framing },
      );
    case 'border':
      return describeBorder(after.border);
    case 'perspective':
      return describeKeystoneChange(before.keystone ?? null, after.keystone ?? null);
    case 'lens':
      return describeLensChange(before.lens ?? null, after.lens ?? null);
    case 'detail':
      return describeDetailChange(before.detail ?? null, after.detail ?? null);
    case 'vignette':
      return describeVignetteChange(after.vignette ?? null);
    case 'repair':
      return describeRepair(after.repair ?? []);
    case 'layers':
      return describeLayersChange(before.layers ?? [], after.layers ?? []);
  }
}

/** A chapter's caption: its sections' changes, how it came to be where that matters. */
export function chapterCaption(sections: readonly PictureEdit[], before: RollPicture, after: RollPicture, via: JournalVia | null): string {
  if (via === 'reset') return `Reset ${sections.map((s) => sectionLabel(s).toLowerCase()).join(', ')}`;
  const body = sections.map((s) => describeChange(s, before, after)).join(' · ');
  if (via === 'auto') return `${body} · by Auto, as it opened`;
  if (via === 'agent') return `${body} · by an agent`;
  return via === 'apply' || via === 'paste' ? `${body} · from another picture` : body;
}

// --- the region: read in the step's own geometry ------------------------------

function box(cx: number, cy: number, rx: number, ry: number): Region {
  return { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry };
}

function union(a: Region | null, b: Region): Region {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** A radius in half-diagonal units (the masks' and patches' unit) as fractions of the width and the height. */
function halfDiagonal(radius: number, aspectRatio: number): { rx: number; ry: number } {
  const ar = aspectRatio > 0 ? aspectRatio : 1;
  return { rx: radius * 0.5 * Math.sqrt(1 + 1 / (ar * ar)), ry: radius * 0.5 * Math.sqrt(1 + ar * ar) };
}

function patchRegion(patches: readonly Patch[], aspectRatio: number): Region | null {
  let out: Region | null = null;
  for (const p of patches) {
    const { rx, ry } = halfDiagonal(p.radius, aspectRatio);
    out = union(out, box(p.x, p.y, rx, ry));
    if (p.kind === 'clone' || p.dx || p.dy) out = union(out, box(p.x + p.dx, p.y + p.dy, rx, ry));
  }
  return out;
}

function maskRegion(mask: Mask | null, aspectRatio: number): Region | null {
  if (!mask) return null;
  if (mask.kind === 'radial') {
    const { rx } = halfDiagonal(mask.radiusX + mask.feather, aspectRatio);
    const { ry } = halfDiagonal(mask.radiusY + mask.feather, aspectRatio);
    return box(mask.x, mask.y, rx, ry);
  }
  if (mask.kind === 'brush') {
    let out: Region | null = null;
    for (const s of mask.strokes) {
      const { rx, ry } = halfDiagonal(s.radius, aspectRatio);
      for (const [x, y] of s.points) out = union(out, box(x, y, rx, ry));
    }
    return out;
  }
  if (mask.kind === 'subject' || mask.kind === 'colour') {
    const pts = mask.kind === 'subject' ? mask.points.map(([x, y]) => [x, y] as const) : mask.samples.map((s) => [s.x, s.y] as const);
    let out: Region | null = null;
    for (const [x, y] of pts) out = union(out, box(x, y, 0.15, 0.15));
    return out;
  }
  // A band, a luma range, a shade: the whole picture is where they are.
  return null;
}

/** Where a chapter's step happened, padded, held inside the picture — or null for the whole picture. */
export function chapterRegion(section: PictureEdit, before: RollPicture, after: RollPicture, aspectRatio: number): Region | null {
  let raw: Region | null = null;
  if (section === 'repair') {
    const wasIds = new Map((before.repair ?? []).map((p) => [p.id, JSON.stringify(p)] as const));
    const changed = (after.repair ?? []).filter((p) => wasIds.get(p.id) !== JSON.stringify(p));
    raw = patchRegion(changed.length ? changed : (after.repair ?? []), aspectRatio);
  } else if (section === 'layers') {
    const changed = changedLayers(before.layers ?? [], after.layers ?? []);
    for (const l of changed.length ? changed : (after.layers ?? [])) {
      const r = maskRegion(l.mask, aspectRatio);
      if (!r) return null;
      raw = union(raw, r);
    }
  }
  if (!raw) return null;
  const pad = 0.5;
  const w = raw.w * (1 + pad);
  const h = raw.h * (1 + pad);
  const x = clamp(raw.x - (w - raw.w) / 2, 0, 1);
  const y = clamp(raw.y - (h - raw.h) / 2, 0, 1);
  return { x, y, w: clamp(w, 0, 1 - x), h: clamp(h, 0, 1 - y) };
}

/** The camera that shows a region filling `CAMERA_FILL` of the frame, its window kept inside the picture. */
export function cameraFor(region: Region | null): Camera {
  if (!region || region.w <= 0 || region.h <= 0) return { ...WHOLE_PICTURE };
  const z = clamp(CAMERA_FILL / Math.max(region.w, region.h), 1, CAMERA_MAX_ZOOM);
  const half = 0.5 / z;
  return { cx: clamp(region.x + region.w / 2, half, 1 - half), cy: clamp(region.y + region.h / 2, half, 1 - half), z };
}

// --- chapters ------------------------------------------------------------------

function sameList(a: readonly PictureEdit[], b: readonly PictureEdit[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

function leadingSection(sections: readonly PictureEdit[]): PictureEdit {
  return [...sections].sort((a, b) => SECTION_WEIGHT[b] - SECTION_WEIGHT[a] || PICTURE_EDITS.indexOf(a) - PICTURE_EDITS.indexOf(b))[0];
}

export interface PictureChapters {
  chapters: Chapter[];
  /** The picture as shot — the state every chapter is folded from. */
  asShot: RollPicture;
  recorded: boolean;
  reconstructed: PictureEdit[];
}

/**
 * The picture's journal as chapters, oldest first. A step that changed
 * nothing of what is set (an undone-then-redone value) leaves no chapter.
 * `aspectRatio` is the picture's own w / h, for the regions' units.
 */
export function pictureChapters(p: RollPicture, aspectRatio = 1): PictureChapters {
  const { steps, recorded, reconstructed } = pictureJournal(p);
  const base = asShot(p);
  let state = base;
  const chapters: Chapter[] = [];
  for (const step of steps) {
    const next = withSectionValues(state, step.after);
    const changed = sectionsChanged(state, next);
    // A step that changed nothing keeps the running STATE OBJECT: the next
    // chapter's `before` must be the previous one's `after` by identity, since
    // that identity is what the painter's rasters are keyed on.
    if (changed.length === 0) continue;
    const via = step.via ?? null;
    const last = chapters[chapters.length - 1];
    if (last && sameList(last.sections, changed) && last.via === via) {
      last.after = next;
      last.at = step.at;
    } else {
      chapters.push({
        id: String(step.at),
        section: leadingSection(changed),
        sections: changed,
        before: state,
        after: next,
        caption: '',
        via,
        weight: SECTION_WEIGHT[leadingSection(changed)],
        absorbed: [],
        region: null,
        at: step.at,
      });
    }
    state = next;
  }
  // A folded run may end where it started (a slider put back): drop it, and
  // close the chain over it — the dropped run's two ends are equal in value,
  // so the chapter after it starts from the chapter before it.
  const live = chapters.filter((c) => sectionsChanged(c.before, c.after).length > 0);
  live.forEach((c, i) => {
    c.before = i === 0 ? base : live[i - 1].after;
  });
  for (const c of live) {
    c.sections = sectionsChanged(c.before, c.after);
    c.section = leadingSection(c.sections);
    c.weight = SECTION_WEIGHT[c.section];
    c.caption = chapterCaption(c.sections, c.before, c.after, c.via);
    c.region = chapterRegion(c.section, c.before, c.after, aspectRatio);
  }
  return { chapters: live, asShot: base, recorded, reconstructed };
}

/** How many chapters a video of `seconds` keeps: 5 at 15 s, 8 at 30, 14 at 60. */
export function keepCount(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 3;
  if (seconds <= 15) return Math.max(2, Math.round((5 * seconds) / 15));
  if (seconds <= 30) return Math.round(5 + (seconds - 15) / 5);
  if (seconds <= 60) return Math.round(8 + (seconds - 30) / 5);
  return Math.min(24, Math.round(14 + (seconds - 60) / 6));
}

/**
 * At most `keep` chapters: the lightest fold into the one that follows them
 * (the last one, when nothing follows), whose `before` reaches back to theirs
 * and whose caption says what it carries. `hidden` chapters fold the same way.
 */
export function keptChapters(chapters: readonly Chapter[], keep: number, hidden: ReadonlySet<string> = new Set()): Chapter[] {
  const candidates = chapters.filter((c) => !hidden.has(c.id));
  const drop = new Set<string>(chapters.filter((c) => hidden.has(c.id)).map((c) => c.id));
  if (candidates.length > keep) {
    const byWeight = [...candidates].sort((a, b) => a.weight - b.weight || a.at - b.at);
    for (const c of byWeight.slice(0, candidates.length - Math.max(1, keep))) drop.add(c.id);
  }
  const out: Chapter[] = [];
  let pending: Chapter[] = [];
  for (const c of chapters) {
    if (drop.has(c.id)) {
      pending.push(c);
      continue;
    }
    out.push(pending.length ? absorb(c, pending, 'before') : c);
    pending = [];
  }
  if (pending.length) {
    if (out.length === 0) return [absorb(pending[pending.length - 1], pending.slice(0, -1), 'before')];
    out[out.length - 1] = absorb(out[out.length - 1], pending, 'after');
  }
  return out;
}

/** `into` carrying `folded`: their change on its before side (they came first) or its after side (they came last). */
function absorb(into: Chapter, folded: readonly Chapter[], side: 'before' | 'after'): Chapter {
  if (folded.length === 0) return into;
  const absorbed = [...into.absorbed, ...folded.flatMap((c) => c.sections)];
  const before = side === 'before' ? folded[0].before : into.before;
  const after = side === 'after' ? folded[folded.length - 1].after : into.after;
  const said = absorbed.map((s) => sectionLabel(s).toLowerCase());
  return {
    ...into,
    before,
    after,
    absorbed,
    caption: `${into.caption} · + ${[...new Set(said)].join(', ')}`,
  };
}
