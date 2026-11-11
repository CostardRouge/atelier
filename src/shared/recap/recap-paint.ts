/**
 * The recap's PAINTER: one page at one moment, onto any 2D context — the
 * stage's canvas at its size, the export's at 1080 px. It draws only what
 * the layout says and the plan times (`recap-layout.ts`, `recap-motion.ts`),
 * and it reads pictures through `PaintSources`, so it never fetches, decodes
 * or waits: a picture not yet in hand is a quiet placeholder, never a gap the
 * export would freeze into the film.
 *
 * DOM-free: a recording context checks it in node (`testing.md`).
 */

import type { RecapDoc, RecapPicture } from './recap-doc';
import { insets, type Box, type CellPart, type RecapLayout, type RecapPage, type TextPart } from './recap-layout';
import { PIN, placeMarks, placeName, writtenPlace, type PinCorner } from './recap-places';
import { cellLook, clipTime, loopTime, textLook, zoomedBox, type FilmPlan, type PagePlan } from './recap-motion';
import { backgroundPicture, deviceLabel, fillText, type DeviceAliases, type RecapSlot, type ResolvedRecap } from './recap-slots';
import { shortDate } from './recap-days';
import { framedDraw, type Frame } from './recap-frame';
import { sheetView, type SheetDecorItem } from './recap-sheet';
import { pushIn } from './recap-second';
import { bandsAt } from './recap-bands';
import { DEFAULT_EXIF_PARTS, JOIN, arrangeBits, cellDate, exifBits, fitText } from './recap-cellwords';
import { docOn, inFamily } from './recap-scope';
import { DEFAULT_TEXT_STYLE, familyOf, italicOf, shippedWeight, textStyleOf, type TextRole } from './recap-text';
import { glowLayersFor, halolight, warmDrift } from '../overlay/title-styles';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Something the painter can draw, with its own pixel size. */
export interface Drawable {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface PaintSources {
  /** The still a picture draws — its print, developed — or null while it is not in hand. */
  still(key: string): Drawable | null;
  /** A clip's frame at its own `seconds`; null falls back to its still. */
  clip?(key: string, seconds: number): Drawable | null;
  /** The looping background's frame at its own `seconds`. */
  background?(seconds: number): Drawable | null;
  /** The background clip's length, for the loop. */
  backgroundLength?: number;
}

export interface PaintOptions {
  /** The film's time, seconds. */
  t: number;
  /** The page drawn. */
  page: number;
  aliases?: DeviceAliases;
  /** A clip's slide on a carousel, by slot (`clipSlideNumbers`). */
  clipSlides?: ReadonlyMap<string, number>;
  /** The editor's stage: an empty place shows a faint frame the export never draws. */
  editing?: boolean;
  /** The film playing a Sheet: the camera travels along it (`sheetView`) instead of cutting from slide to slide. */
  pan?: boolean;
}

export const PAPER = '#f4f0e7';
export const INK = '#141210';
export const PAPER_INK = '#1b1813';
export const ON_MEDIA = '#f4f0e7';
export const ACCENT = '#d9442a';
const PLACEHOLDER_DARK = 'rgba(244,240,231,0.08)';
const PLACEHOLDER_LIGHT = 'rgba(27,24,19,0.07)';

export const FACES: Record<RecapDoc['font'], string> = {
  sans: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
  serif: '"Instrument Serif", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};
export const MONO = FACES.mono;

/** The faces the painter sets text in, as `document.fonts.load` takes them — canvas text needs them loaded first. */
export const PAINT_FONTS = ['400 40px "Space Grotesk"', '500 40px "Space Grotesk"', '400 40px "Instrument Serif"', '400 40px "JetBrains Mono"', '500 40px "JetBrains Mono"'];

/** True when the recap's ground is light — its words are then ink, not paper. */
export function isLightGround(doc: RecapDoc): boolean {
  if (doc.background.kind === 'paper') return true;
  if (doc.background.kind !== 'colour') return false;
  const c = doc.background.colour;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

/** `src` drawn to cover `box` — cropped, never stretched — around its `frame`'s focus, at its zoom. */
export function drawCover(g: Ctx2D, src: Drawable, box: Box, frame?: Frame): void {
  if (src.width <= 0 || src.height <= 0 || box.w <= 0 || box.h <= 0) return;
  const d = framedDraw(src.width, src.height, box, frame);
  if (!d.angle) {
    g.drawImage(src.image, d.win.sx, d.win.sy, d.win.sw, d.win.sh, box.x, box.y, box.w, box.h);
    return;
  }
  // Turned: drawn around the box's centre, larger, so its corners land on picture (the caller clips to the box).
  g.save();
  g.translate(d.cx, d.cy);
  g.rotate(d.angle);
  g.drawImage(src.image, d.win.sx, d.win.sy, d.win.sw, d.win.sh, -d.w / 2, -d.h / 2, d.w, d.h);
  g.restore();
}

function roundRect(g: Ctx2D, b: Box, r: number): void {
  const rr = Math.max(0, Math.min(r, b.w / 2, b.h / 2));
  g.beginPath();
  g.moveTo(b.x + rr, b.y);
  g.lineTo(b.x + b.w - rr, b.y);
  g.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + rr, rr);
  g.lineTo(b.x + b.w, b.y + b.h - rr);
  g.arcTo(b.x + b.w, b.y + b.h, b.x + b.w - rr, b.y + b.h, rr);
  g.lineTo(b.x + rr, b.y + b.h);
  g.arcTo(b.x, b.y + b.h, b.x, b.y + b.h - rr, rr);
  g.lineTo(b.x, b.y + rr);
  g.arcTo(b.x, b.y, b.x + rr, b.y, rr);
  g.closePath();
}

function setSpacing(g: Ctx2D, em: number, size: number): void {
  const s = g as Ctx2D & { letterSpacing?: string };
  if ('letterSpacing' in s) s.letterSpacing = `${(em * size).toFixed(2)}px`;
}

interface TextFx {
  weight?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  spacing?: number;
  /** The default legibility shadow of a place drawn over pictures. */
  shadow?: boolean;
  italic?: boolean;
  /** A role's own effects (`recap-text.ts`), in fractions of the size. */
  outline?: number;
  outlineColour?: string;
  ownShadow?: { darkness: number; blur: number; y: number };
  glow?: { amount: number; warmth: number };
}

/** The room the pin takes in a line of text (`{place}`): the teardrop and a little air after it. */
const pinRoom = (size: number) => size * 0.95;

function text(g: Ctx2D, value: string, x: number, y: number, size: number, face: string, colour: string, opts: TextFx = {}): void {
  if (value.includes(PIN)) {
    textWithPin(g, value, x, y, size, face, colour, opts);
    return;
  }
  const px = Math.max(1, Math.round(size));
  g.font = `${opts.italic ? 'italic ' : ''}${opts.weight ?? 400} ${px}px ${face}`;
  g.textAlign = opts.align ?? 'left';
  g.textBaseline = opts.baseline ?? 'alphabetic';
  setSpacing(g, opts.spacing ?? 0, size);
  const clear = () => {
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
  };
  // The glow, as the suite's title styles draw it: a wide warm bleed, then a tight bright halo.
  if (opts.glow && opts.glow.amount > 0) {
    const layers = glowLayersFor({ glowAmount: opts.glow.amount, glowWarmth: opts.glow.warmth } as Parameters<typeof glowLayersFor>[0]);
    const [wr, wg, wb] = warmDrift(colour, opts.glow.warmth);
    g.fillStyle = colour;
    if (layers.bleedRadiusFrac > 0 && layers.bleedAlpha > 0) {
      g.shadowColor = `rgba(${wr},${wg},${wb},${layers.bleedAlpha})`;
      g.shadowBlur = layers.bleedRadiusFrac * size;
      g.fillText(value, x, y);
      g.fillText(value, x, y);
    }
    if (layers.haloRadiusFrac > 0 && layers.haloAlpha > 0) {
      g.shadowColor = halolight(colour, layers.haloAlpha);
      g.shadowBlur = Math.max(1, layers.haloRadiusFrac * size);
      g.fillText(value, x, y);
    }
    clear();
  }
  const shadow = opts.ownShadow && opts.ownShadow.darkness > 0 ? opts.ownShadow : opts.shadow ? { darkness: 0.55, blur: 0.35, y: 0.06 } : null;
  if (shadow) {
    g.shadowColor = `rgba(0,0,0,${shadow.darkness})`;
    g.shadowBlur = size * shadow.blur;
    g.shadowOffsetY = size * shadow.y;
  }
  // The outline under the fill, twice its width so the outside half shows and the letter keeps its own shape.
  if (opts.outline && opts.outline > 0) {
    g.lineJoin = 'round';
    g.lineWidth = Math.max(1, opts.outline * size * 2);
    g.strokeStyle = opts.outlineColour ?? '#000000';
    g.strokeText(value, x, y);
    clear();
  }
  g.fillStyle = colour;
  g.fillText(value, x, y);
  clear();
  setSpacing(g, 0, size);
}

/** A line holding the pin (`{place}`, lab 11): its words drawn in turn from the left, the pin in the accent where it stands. */
function textWithPin(g: Ctx2D, value: string, x: number, y: number, size: number, face: string, colour: string, opts: TextFx): void {
  const px = Math.max(1, Math.round(size));
  const pieces = value.split(PIN);
  g.font = `${opts.italic ? 'italic ' : ''}${opts.weight ?? 400} ${px}px ${face}`;
  setSpacing(g, opts.spacing ?? 0, size);
  const widths = pieces.map((p) => (p ? g.measureText(p).width : 0));
  setSpacing(g, 0, size);
  const total = widths.reduce((a, b) => a + b, 0) + (pieces.length - 1) * pinRoom(size);
  let cx = opts.align === 'center' ? x - total / 2 : opts.align === 'right' || opts.align === 'end' ? x - total : x;
  // A middle baseline lifts the pin with the words.
  const foot = opts.baseline === 'middle' ? y + size * 0.42 : opts.baseline === 'top' || opts.baseline === 'hanging' ? y + size * 0.86 : y;
  pieces.forEach((piece, i) => {
    if (i > 0) {
      const s = size * 0.92;
      g.save();
      if (opts.shadow || (opts.ownShadow && opts.ownShadow.darkness > 0)) {
        g.shadowColor = 'rgba(0,0,0,0.45)';
        g.shadowBlur = size * 0.25;
        g.shadowOffsetY = size * 0.04;
      }
      drawPin(g, cx + s * 0.38, foot + size * 0.06, s);
      g.restore();
      cx += pinRoom(size);
    }
    if (piece) text(g, piece, cx, y, size, face, colour, { ...opts, align: 'left' });
    cx += widths[i];
  });
}

/**
 * A calendar's RUNS OF DAYS (lab 11, off until he turns them on): under each
 * row a hairline in the accent from the run's first day to its last, the pin
 * and `Albany · 8–14` under it — on a week, one line over the bands above
 * their numbers. They fade in with the grid.
 */
function drawRuns(g: Ctx2D, doc: RecapDoc, page: RecapPage, cells: readonly CellPart[], plan: PagePlan, t: number, light: boolean): void {
  // With the grid, as the weekdays: there before the pictures land on it.
  const alpha = textLook(doc.motion.title === 'none' ? 'none' : 'fade', plan.heading, t).alpha;
  if (alpha <= 0) return;
  const W = page.width;
  const H = page.height;
  const boxes = new Map(cells.map((c) => [c.id, c.box]));
  const week = doc.template === 'week';
  const size = W * (week ? 0.019 : 0.0175);
  const thick = Math.max(1, W * 0.0022);
  const colour = week ? ON_MEDIA : light ? PAPER_INK : ON_MEDIA;
  const laid = (page.runs ?? []).flatMap((r) => {
    const a = boxes.get(r.from);
    const b = boxes.get(r.to);
    if (!a || !b) return [];
    const numberSize = sizeIn(doc, 'dayNumber', Math.min(a.w * 0.42, W * 0.05));
    const lineY = week ? H - H * 0.16 - numberSize * 1.25 : a.y + a.h + W * 0.009;
    return [{ r, x0: a.x + thick, x1: b.x + b.w - thick, lineY }];
  });
  g.save();
  g.globalAlpha = alpha;
  for (const s of laid) {
    g.fillStyle = ACCENT;
    g.fillRect(s.x0, s.lineY, Math.max(thick, s.x1 - s.x0), thick);
  }
  for (const s of laid) {
    if (!s.r.label) continue;
    // Its words run to the next run's words on the same row, never over them.
    const next = laid.find((o) => o !== s && o.r.label && o.r.row === s.r.row && o.x0 > s.x0);
    const room = (next ? next.x0 - size * 0.6 : week ? W - size * 0.6 : Math.max(...laid.filter((o) => o.r.row === s.r.row).map((o) => o.x1), s.x1)) - s.x0;
    g.font = `600 ${Math.round(size)}px ${FACES.sans}`;
    const fit = fitText(s.r.label, room - pinRoom(size), (v) => g.measureText(v).width, 0.8);
    const baseline = week ? s.lineY - size * 0.55 : s.lineY + thick + size * 1.2;
    text(g, PIN + fit.text, s.x0, baseline, size * fit.scale, FACES.sans, colour, { weight: 600, shadow: week });
  }
  g.restore();
}

/** What a place draws by default: its face, colour, weight, case, spacing and legibility shadow. */
export interface Place {
  face: string;
  colour: string;
  weight?: number;
  upper?: boolean;
  spacing?: number;
  shadow?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Never wider than this: shrunk a little, then cut with an ellipsis (`fitText`). */
  maxWidth?: number;
}

/** What `value` measures in `role`'s style at `size` — the width `styled` would draw. */
function measurer(g: Ctx2D, doc: RecapDoc, role: TextRole, size: number, place: Place): (value: string) => number {
  const st = textStyleOf(doc.texts, role);
  const owned = st !== DEFAULT_TEXT_STYLE;
  const upper = st.upper ?? place.upper ?? false;
  const px = Math.max(1, Math.round(size * st.size));
  const weight = owned && (st.font !== 'auto' || st.weight !== DEFAULT_TEXT_STYLE.weight) ? shippedWeight(st) : (place.weight ?? 400);
  const font = `${italicOf(st) ? 'italic ' : ''}${weight} ${px}px ${familyOf(st, place.face)}`;
  const spacing = st.tracking ?? place.spacing ?? 0;
  return (value) => {
    g.font = font;
    setSpacing(g, spacing, size * st.size);
    // The pin is no letter of the face: it takes its own room.
    const pins = value.split(PIN).length - 1;
    const w = g.measureText((upper ? value.toUpperCase() : value).split(PIN).join('')).width + pins * pinRoom(size * st.size);
    setSpacing(g, 0, size);
    return w;
  };
}

/** The size a role draws at, from its place's own. */
export function sizeIn(doc: RecapDoc, role: TextRole, size: number): number {
  return size * textStyleOf(doc.texts, role).size;
}

/** A text of `role`, in the role's own style over its place's defaults (`recap-text.ts`). */
export function styled(g: Ctx2D, doc: RecapDoc, role: TextRole, value: string, x: number, y: number, size: number, place: Place): void {
  if (place.maxWidth !== undefined && value) {
    const fit = fitText(value, place.maxWidth, measurer(g, doc, role, size, place));
    value = fit.text;
    size *= fit.scale;
  }
  const st = textStyleOf(doc.texts, role);
  const owned = st !== DEFAULT_TEXT_STYLE;
  const upper = st.upper ?? place.upper ?? false;
  text(g, upper ? value.toUpperCase() : value, x, y, size * st.size, familyOf(st, place.face), st.colour ?? place.colour, {
    weight: owned && (st.font !== 'auto' || st.weight !== DEFAULT_TEXT_STYLE.weight) ? shippedWeight(st) : place.weight,
    align: place.align,
    baseline: place.baseline,
    spacing: st.tracking ?? place.spacing ?? 0,
    shadow: place.shadow,
    italic: italicOf(st),
    outline: st.outline,
    outlineColour: st.outlineColour,
    ownShadow: { darkness: st.shadow, blur: st.shadowBlur, y: st.shadowY },
    glow: { amount: st.glow, warmth: st.glowWarmth },
  });
}

/** Where a cell's number sits in it: its corner, or its middle. */
function numberAt(doc: RecapDoc, box: Box, s: number, size: number): { x: number; y: number; align: CanvasTextAlign } {
  const pad = s * 0.08;
  switch (doc.cells.numberAt) {
    case 'topRight':
      return { x: box.x + box.w - pad, y: box.y + size * 1.15, align: 'right' };
    case 'centre':
      return { x: box.x + box.w / 2, y: box.y + box.h / 2 + size * 0.36, align: 'center' };
    case 'bottomLeft':
    case 'foot':
      return { x: box.x + pad, y: box.y + box.h - pad, align: 'left' };
    default:
      return { x: box.x + pad, y: box.y + size * 1.15, align: 'left' };
  }
}

/** The camera's settings a cell says for `p`: its own choice, else the recap's; the device alone when only it is asked. */
export function cellBits(doc: RecapDoc, p: RecapPicture, aliases: DeviceAliases = {}): string[] {
  const named = (d: string) => deviceLabel(d, aliases);
  if (doc.cells.exif) return exifBits(p, p.exifParts ?? doc.cells.exifParts, named);
  return doc.cells.device && p.device ? [named(p.device)] : [];
}

/** The camera's line: `α7 IV · 35 mm · f/1.8 · 1/250 · ISO 100`. */
export function exifLine(p: RecapPicture, aliases: DeviceAliases = {}): string {
  return exifBits(p, p.exifParts ?? DEFAULT_EXIF_PARTS, (d) => deviceLabel(d, aliases)).join(JOIN);
}

function background(g: Ctx2D, doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number, t: number, src: PaintSources): void {
  const bg = doc.background;
  g.globalAlpha = 1;
  g.fillStyle = bg.kind === 'paper' ? PAPER : bg.kind === 'colour' ? bg.colour : INK;
  g.fillRect(0, 0, W, H);
  let drew = false;
  if (bg.kind === 'video' && src.background) {
    const frame = src.background(loopTime(bg, src.backgroundLength ?? 0, t));
    if (frame) {
      drawCover(g, frame, { x: 0, y: 0, w: W, h: H }, bg.frame);
      drew = true;
    }
  } else if (bg.kind === 'blur') {
    // His picture, else the best photograph of the period (`backgroundPicture`) — chosen once per document.
    const first = chosenBackground(doc, resolved);
    const still = first ? src.still(first.key) : null;
    if (still) {
      const px = Math.round(bg.blur * (W / 1080));
      const held = blurredOnce(still, W, H, px, bg.frame);
      if (held) g.drawImage(held, 0, 0, W, H);
      else blurInto(g, still, W, H, px, bg.frame);
      drew = true;
    }
  }
  if (drew || bg.kind === 'colour') {
    if (bg.veil > 0) {
      g.fillStyle = `rgba(0,0,0,${bg.veil})`;
      g.fillRect(0, 0, W, H);
    }
  }
}

/**
 * The blurred ground does not move with the film: its picture is chosen ONCE per document (a ranking of the
 * whole pool, per frame before — `performance.md`), and blurred ONCE per picture, size and frame into a page
 * of its own the frames draw. A full-page blur per frame is the one cost of this painter a phone feels most.
 */
const picked = new WeakMap<ResolvedRecap, { doc: RecapDoc; picture: RecapPicture | null }>();
function chosenBackground(doc: RecapDoc, resolved: ResolvedRecap): RecapPicture | null {
  const kept = picked.get(resolved);
  if (kept && kept.doc === doc) return kept.picture;
  const picture = backgroundPicture(doc, resolved);
  picked.set(resolved, { doc, picture });
  return picture;
}

/** Draw `still` blurred over a `W`×`H` page, a little larger so the blur's soft edge falls outside it. */
function blurInto(g: Ctx2D, still: Drawable, W: number, H: number, px: number, frame: Frame | undefined): void {
  const f = g as Ctx2D & { filter?: string };
  const had = 'filter' in f ? f.filter : undefined;
  if (had !== undefined) f.filter = `blur(${px}px)`;
  drawCover(g, still, { x: -W * 0.06, y: -H * 0.06, w: W * 1.12, h: H * 1.12 }, frame);
  if (had !== undefined) f.filter = had;
}

/** Each picture's blurred pages, the last few sizes asked (the stage, the strip, an export). */
const blurred = new WeakMap<object, { key: string; page: OffscreenCanvas }[]>();
const BLURRED_SIZES = 3;
function blurredOnce(still: Drawable, W: number, H: number, px: number, frame: Frame | undefined): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined' || !(W > 0) || !(H > 0)) return null;
  const owner = still.image as object;
  const key = `${Math.round(W)}x${Math.round(H)}|${px}|${frame ? `${frame.x},${frame.y},${frame.zoom},${frame.rotate ?? 0}` : '-'}`;
  const list = blurred.get(owner) ?? [];
  const hit = list.find((e) => e.key === key);
  if (hit) return hit.page;
  const page = new OffscreenCanvas(Math.round(W), Math.round(H));
  const pg = page.getContext('2d');
  if (!pg) return null;
  blurInto(pg, still, W, H, px, frame);
  list.push({ key, page });
  if (list.length > BLURRED_SIZES) list.shift();
  blurred.set(owner, list);
  return page;
}

function slotPicture(slot: RecapSlot | undefined): RecapPicture | null {
  return slot?.picture ?? null;
}

/**
 * The PIN (lab 11, his pick): the Maps teardrop with its hole, its tip at
 * (`x`, `y`), `s` tall — the one mark for «where», in a cell's pill, at the
 * head of a run of days, before a title's `{place}`.
 */
export function drawPin(g: Ctx2D, x: number, y: number, s: number, colour: string = ACCENT): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = colour;
  g.beginPath();
  g.arc(0, -s * 0.62, s * 0.36, Math.PI * 0.82, Math.PI * 0.18, false);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(0, -s * 0.62, s * 0.14, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Where a cell's place pill lies: its box, its words, and whether it sits at the bottom (the cell's words then lift over it). */
interface PinPill {
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  /** The town as it fits; empty when only the pin fits (a small cell). */
  label: string;
  /** At the bottom among the cell's words: they lift over it. */
  bottom: boolean;
}

/** The cells of `layout` that wear the pill, by id → the name it says; kept per layout and mode (the painter runs every frame). */
const marksKept = new WeakMap<RecapLayout, { mode: string; slots: ResolvedRecap['slots']; marks: Map<string, string> }>();
function cellMarks(doc: RecapDoc, resolved: ResolvedRecap, layout: RecapLayout): Map<string, string> {
  const kept = marksKept.get(layout);
  const mode = `${doc.places.cells}|${doc.places.writing}|${doc.places.country}`;
  if (kept && kept.mode === mode && kept.slots === resolved.slots) return kept.marks;
  const byId = new Map(resolved.slots.map((s) => [s.id, s]));
  const cells = layout.pages.flatMap((p) => p.parts.filter((x): x is CellPart => x.kind === 'cell').sort((a, b) => a.index - b.index));
  const marks = placeMarks(
    cells.map((c) => {
      const pic = byId.get(c.id)?.picture;
      return { id: c.id, place: placeName(pic), written: writtenPlace(pic, doc.places.writing), country: pic?.country ?? null };
    }),
    doc.places.cells,
    doc.places.country,
  );
  marksKept.set(layout, { mode, slots: resolved.slots, marks });
  return marks;
}

function pinPill(g: Ctx2D, doc: RecapDoc, name: string, part: CellPart, box: Box, W: number, H: number, bleed: boolean): PinPill {
  const s = Math.min(box.w, box.h);
  const size = Math.max(6, Math.min(W * 0.024, s * 0.13));
  const corner: PinCorner = doc.places.corner;
  const pad = size * 0.5;
  const glyphW = size * 1.05;
  const inset = Math.max(3, s * 0.05);
  g.font = `600 ${Math.round(size)}px ${FACES.sans}`;
  const room = box.w - inset * 2 - pad * 2 - glyphW;
  // A cell too small for a word: the pin alone, in its round of glass.
  const fit = room >= size * 2.2 ? fitText(name, room, (v) => g.measureText(v).width, 0.85) : null;
  const label = fit ? fit.text : '';
  const tw = fit ? g.measureText(label).width * fit.scale : 0;
  const h = size * 1.75;
  const w = label ? pad * 2 + glyphW + tw : h;
  const left = corner === 'bottomLeft' || corner === 'topLeft';
  const bottom = corner === 'bottomLeft' || corner === 'bottomRight';
  const x = left ? box.x + inset : box.x + box.w - inset - w;
  let y: number;
  let under = false;
  // A cell whose words lie low over its picture (a single, a dump's page): in the margin under them when it fits there.
  const margin = Math.min(H * 0.06, box.h * 0.08);
  if (bottom && part.words === 'bottom' && doc.template !== 'week' && margin >= h + size * 0.6) {
    y = box.y + box.h - margin + Math.max(size * 0.35, (margin - h) / 2);
    under = true;
  } else if (bottom) {
    let foot = box.y + box.h - inset;
    // A week's band: above its day's number. A page the picture covers: out of the format's bottom margin.
    if (doc.template === 'week' && part.words === 'bottom') foot = box.y + box.h - H * 0.16 - sizeIn(doc, 'dayNumber', Math.min(box.w * 0.42, W * 0.05)) * (doc.places.runs ? 1.25 : 1.1) - (doc.places.runs ? W * 0.05 : 0);
    else if (bleed) foot = Math.min(foot, H - insets(doc.format, H).bottom - W * 0.02);
    y = foot - h;
  } else {
    y = box.y + inset;
    if (bleed) y = Math.max(y, insets(doc.format, H).top);
    // Under the day's number when they share the corner.
    const numberCorner = doc.cells.numberAt === corner;
    if (numberCorner && doc.cells.number && part.words === 'inside') y = box.y + sizeIn(doc, 'dayNumber', Math.max(10, Math.min(W * 0.022, s * 0.16))) * 1.45;
  }
  return { x, y, w, h, size: fit ? size * fit.scale : size, label, bottom: bottom && !under };
}

/** The pill: glass — a soft dark round under white words, a hairline of light — the pin in the accent, the town. */
function drawPinPill(g: Ctx2D, p: PinPill): void {
  g.save();
  roundRect(g, { x: p.x, y: p.y, w: p.w, h: p.h }, p.h / 2);
  g.fillStyle = 'rgba(16,14,12,0.55)';
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = Math.max(0.75, p.h * 0.03);
  g.stroke();
  const pinS = p.h * 0.56;
  const px = p.label ? p.x + p.h * 0.5 : p.x + p.w / 2;
  drawPin(g, px, p.y + p.h / 2 + pinS * 0.5, pinS);
  if (p.label) text(g, p.label, p.x + p.h * 0.5 + p.h * 0.42, p.y + p.h * 0.66, p.size, FACES.sans, ON_MEDIA, { weight: 600 });
  g.restore();
}

function drawCell(
  g: Ctx2D,
  doc: RecapDoc,
  part: CellPart,
  slot: RecapSlot | undefined,
  plan: PagePlan,
  t: number,
  W: number,
  H: number,
  src: PaintSources,
  opts: PaintOptions,
  light: boolean,
  /** A week's band in motion (`recap-bands.ts`): a veil over it, its picture's drift. */
  fx: { dim: number; pan: number } | null = null,
  /** The place its pill says (`recap-places.ts`), and whether its page bleeds; null = no pill. */
  pin: { name: string; bleed: boolean } | null = null,
  /** The style its date wears: the day numbers', or the highlights' own (`flowDate`, lab 17). */
  dateRole: TextRole = 'dayNumber',
): void {
  const pic = slotPicture(slot);
  const span = plan.cells.get(part.id);
  const look = cellLook(doc.motion.entrance, span, t);
  const windows = plan.clips.get(part.id);
  const playing = pic?.kind === 'video' ? clipTime(windows, pic.duration ?? 0, t) : null;
  let box = part.box;
  if (doc.motion.videos === 'zoom' && windows?.length) {
    for (const w of windows) box = zoomedBox(box, W, H, w, t);
  }
  // What the grid itself wears — the weekdays' fade with the heading: an empty day is there with it, never entering.
  const gridAlpha = textLook(doc.motion.title === 'none' ? 'none' : 'fade', plan.heading, t).alpha;
  const radius = doc.cells.radius * Math.min(box.w, box.h);
  const ink = light ? PAPER_INK : ON_MEDIA;
  const words = part.words;
  const s = Math.min(box.w, box.h);
  const small = Math.max(10, Math.min(W * 0.022, s * 0.16));
  // The date as this page's words say it (lab 17): `auto` prints what the cell always printed.
  const label = cellDate(slot?.picture?.day ?? slot?.day, doc.cells.date, part.number);

  // The rung's words beside its picture (on this day) are drawn whatever the picture's state.
  if (words === 'beside') {
    g.globalAlpha = pic ? textLook(doc.motion.title === 'none' ? 'none' : 'fade', span ?? null, t).alpha : gridAlpha;
    const x = box.x - W * 0.27;
    const size = W * 0.034;
    styled(g, doc, 'labels', part.label ?? '', x, box.y + sizeIn(doc, 'labels', size) * 1.1, size, { face: FACES[doc.font], colour: part.today ? ACCENT : ink, weight: 500 });
    let ly = box.y + box.h - W * 0.012;
    if (doc.cells.device && pic?.device) {
      styled(g, doc, 'labels', deviceLabel(pic.device, opts.aliases), x, ly, W * 0.017, { face: MONO, colour: ink, spacing: 0.04, upper: true });
      ly -= W * 0.028;
    }
    if (slot?.day) styled(g, doc, 'labels', shortDate(slot.day), x, ly, W * 0.019, { face: MONO, colour: ink, spacing: 0.04, upper: true });
    g.globalAlpha = 1;
  }

  if (!pic && doc.template === 'week') {
    // A day of the week with no picture keeps its number and its name, as the bands around it do.
    if (doc.cells.empty === 'hidden' && !opts.editing) return;
    g.globalAlpha = opts.editing ? 1 : gridAlpha;
    if (doc.cells.empty === 'dashed' || opts.editing) {
      g.save();
      g.setLineDash([Math.max(3, W * 0.01), Math.max(3, W * 0.008)]);
      g.strokeStyle = light ? 'rgba(27,24,19,0.35)' : 'rgba(244,240,231,0.4)';
      g.lineWidth = Math.max(1, W * 0.0015);
      g.strokeRect(box.x + 2, box.y + 2, box.w - 4, box.h - 4);
      g.restore();
    }
    if (doc.cells.empty !== 'hidden') {
      const size = Math.min(box.w * 0.42, W * 0.05);
      const cx = box.x + box.w / 2;
      if (doc.cells.number) styled(g, doc, dateRole, label, cx, box.y + box.h - H * 0.16, size, { face: MONO, colour: ink, align: 'center' });
      if (part.label) styled(g, doc, 'labels', part.label, cx, box.y + box.h - H * 0.16 + sizeIn(doc, 'dayNumber', size) * 0.9, size * 0.42, { face: FACES.sans, colour: ink, align: 'center', spacing: 0.12, upper: true });
    }
    g.globalAlpha = 1;
    return;
  }
  if (!pic) {
    if (part.words === 'beside' || doc.template === 'month') {
      const empty = doc.cells.empty;
      if (empty === 'hidden' && !opts.editing) return;
      g.globalAlpha = opts.editing ? 1 : gridAlpha;
      if (empty === 'dashed' || opts.editing) {
        g.save();
        g.setLineDash([Math.max(3, s * 0.06), Math.max(3, s * 0.05)]);
        g.strokeStyle = light ? 'rgba(27,24,19,0.35)' : 'rgba(244,240,231,0.4)';
        g.lineWidth = Math.max(1, W * 0.0015);
        roundRect(g, box, radius);
        g.stroke();
        g.restore();
      }
      if (empty !== 'hidden' && doc.cells.number && words === 'inside') {
        const at = numberAt(doc, box, s, sizeIn(doc, dateRole, small));
        styled(g, doc, dateRole, label, at.x, at.y, small, { face: FACES.sans, colour: ink, weight: 500, align: at.align, maxWidth: box.w - s * 0.16 });
      }
      g.globalAlpha = 1;
    } else if (opts.editing) {
      g.fillStyle = light ? PLACEHOLDER_LIGHT : PLACEHOLDER_DARK;
      roundRect(g, box, radius);
      g.fill();
    }
    return;
  }

  if (look.alpha <= 0) return;
  g.save();
  g.globalAlpha = look.alpha;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  g.translate(cx + look.dx * box.w, cy + look.dy * box.h);
  g.scale(look.scale, look.scale);
  g.translate(-cx, -cy);
  if (part.rot) {
    // A collage's print, turned about its middle.
    g.translate(cx, cy);
    g.rotate(part.rot);
    g.translate(-cx, -cy);
  }
  if (part.print) {
    // A print's border — white with a deeper foot, or thin all round — its shadow under it.
    const b = s * (part.print === 'white' ? 0.035 : 0.012);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = s * 0.06;
    g.shadowOffsetY = s * 0.02;
    g.fillStyle = PAPER;
    g.fillRect(box.x - b, box.y - b, box.w + 2 * b, box.h + b * (part.print === 'white' ? 3.2 : 2));
    g.restore();
  }
  if (doc.cells.shadow > 0 && !part.print) {
    g.shadowColor = `rgba(0,0,0,${doc.cells.shadow})`;
    g.shadowBlur = s * doc.cells.shadowBlur;
    g.shadowOffsetY = s * doc.cells.shadowY;
  }
  const drawable = (playing !== null && src.clip ? src.clip(pic.key, playing) : null) ?? src.still(pic.key);
  roundRect(g, box, radius);
  if (drawable) {
    g.fillStyle = INK;
    g.fill();
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    g.save();
    roundRect(g, box, radius);
    g.clip();
    // One second a day: a still breathes through its second — a slow push-in (`recap-second.ts`).
    const breathe = doc.template === 'second' && playing === null && plan.length > 0 ? pushIn((t - plan.start) / plan.length) : 1;
    let frame = breathe === 1 ? pic.frame : { ...(pic.frame ?? { x: 0.5, y: 0.5, zoom: 1 }), zoom: Math.min(4, (pic.frame?.zoom ?? 1) * breathe) };
    // A week's band: its picture drifts across what the band hides (the window clamps it inside the picture).
    if (fx && fx.pan !== 0) frame = { ...(frame ?? { x: 0.5, y: 0.5, zoom: 1 }), x: Math.min(1, Math.max(0, (frame?.x ?? 0.5) + 0.35 * fx.pan)) };
    drawCover(g, drawable, box, frame);
    if (fx && fx.dim > 0) {
      g.fillStyle = `rgba(10,8,6,${fx.dim})`;
      g.fillRect(box.x, box.y, box.w, box.h);
    }
    g.restore();
  } else {
    g.fillStyle = light ? PLACEHOLDER_LIGHT : PLACEHOLDER_DARK;
    g.fill();
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
  }
  if (look.whiten > 0) {
    g.fillStyle = PAPER;
    g.globalAlpha = look.alpha * look.whiten;
    roundRect(g, box, radius);
    g.fill();
    g.globalAlpha = look.alpha;
  }

  // The place's pill, measured first: at the bottom, the cell's own words lift over it.
  const pill = pin ? pinPill(g, doc, pin.name, part, box, W, H, pin.bleed) : null;
  const lift = pill?.bottom ? pill.h + s * 0.04 : 0;

  // The words over the picture.
  if (words === 'bottom') {
    const grad = g.createLinearGradient(0, box.y + box.h * 0.55, 0, box.y + box.h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = grad;
    g.fillRect(box.x, box.y + box.h * 0.55, box.w, box.h * 0.45);
    if (doc.template === 'week') {
      const size = Math.min(box.w * 0.42, W * 0.05);
      if (doc.cells.number) styled(g, doc, dateRole, label, cx, box.y + box.h - H * 0.16, size, { face: MONO, colour: ON_MEDIA, align: 'center' });
      if (part.label) styled(g, doc, 'labels', part.label, cx, box.y + box.h - H * 0.16 + sizeIn(doc, 'dayNumber', size) * 0.9, size * 0.42, { face: FACES.sans, colour: ON_MEDIA, align: 'center', spacing: 0.12, upper: true });
    } else {
      const size = W * 0.021;
      const place: Place = { face: MONO, colour: ON_MEDIA, spacing: 0.02 };
      const inset = Math.min(W * 0.065, box.w * 0.08);
      const maxW = box.w - inset * 2;
      const step = sizeIn(doc, 'cellWords', size) * 1.5;
      const bottom = box.y + box.h - Math.min(H * 0.06, box.h * 0.08) - lift;
      const room = Math.max(1, Math.floor((box.h * 0.5) / step));
      const cap = doc.cells.caption ? doc.captions[part.id] : undefined;
      const lines = [
        ...(cap ? [cap] : []),
        ...arrangeBits(cellBits(doc, pic, opts.aliases), doc.cells.arrange, maxW, measurer(g, doc, 'cellWords', size, place), box.h > box.w * 1.1, room - (cap ? 1 : 0)),
      ];
      lines.forEach((l, i) => styled(g, doc, 'cellWords', l, box.x + inset, bottom - (lines.length - 1 - i) * step, size, { ...place, maxWidth: maxW }));
    }
  } else if (words === 'inside') {
    let by = box.y + box.h - s * 0.08 - lift;
    if (doc.cells.number && doc.cells.numberAt === 'foot') {
      // Under the picture (lab 17): a soft band low over it and the date on one line — room for «Monday 10 November 2025».
      const size = Math.max(9, Math.min(W * 0.034, s * 0.12));
      const band = Math.min(box.h * 0.45, sizeIn(doc, dateRole, size) * 3.2 + lift);
      const grad = g.createLinearGradient(0, box.y + box.h - band, 0, box.y + box.h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.6)');
      g.fillStyle = grad;
      g.fillRect(box.x, box.y + box.h - band, box.w, band);
      styled(g, doc, dateRole, label, box.x + s * 0.07, by, size, { face: MONO, colour: ON_MEDIA, spacing: 0.02, maxWidth: box.w - s * 0.14 });
      by -= sizeIn(doc, dateRole, size) * 1.5;
    } else if (doc.cells.number) {
      const at = numberAt(doc, box, s, sizeIn(doc, dateRole, small));
      styled(g, doc, dateRole, label, at.x, at.y, small, { face: FACES.sans, colour: ON_MEDIA, weight: 500, shadow: true, align: at.align, maxWidth: box.w - s * 0.16 });
    }
    const tag = (label: string, fill: string) => {
      const size = Math.max(9, small * 0.72);
      g.font = `500 ${Math.round(size)}px ${MONO}`;
      const w = g.measureText(label).width + size * 0.8;
      g.fillStyle = fill;
      roundRect(g, { x: box.x + s * 0.06, y: by - size * 1.35, w, h: size * 1.35 }, size * 0.25);
      g.fill();
      text(g, label, box.x + s * 0.06 + size * 0.4, by - size * 0.38, size, MONO, ON_MEDIA, { weight: 500 });
      by -= size * 1.6;
    };
    if (pic.kind === 'video' && doc.cells.videoBadge) {
      const slide = opts.clipSlides?.get(part.id);
      tag(slide ? `▶ ${slide}` : '▶', ACCENT);
    }
    if (doc.cells.count && slot && slot.candidates.length > 1) tag(`×${slot.candidates.length}`, 'rgba(16,15,13,0.72)');
    const maxW = box.w - s * 0.16;
    if (doc.cells.caption && doc.captions[part.id]) {
      styled(g, doc, 'cellWords', doc.captions[part.id], box.x + s * 0.08, by - small * 0.2, small * 0.9, { face: FACES[doc.font], colour: ON_MEDIA, shadow: true, maxWidth: maxW });
    } else if (doc.cells.exif || doc.cells.device) {
      const size = Math.max(8, small * 0.62);
      const place: Place = { face: MONO, colour: ON_MEDIA, shadow: true };
      const step = sizeIn(doc, 'cellWords', size) * 1.35;
      // Under the number, never over it: the lines take what the cell leaves above its tags.
      const room = Math.max(1, Math.floor((by - box.y - s * 0.3) / step));
      const lines = arrangeBits(cellBits(doc, pic, opts.aliases), doc.cells.arrange, maxW, measurer(g, doc, 'cellWords', size, place), box.h > box.w * 1.1, room);
      lines.forEach((l, i) => styled(g, doc, 'cellWords', l, box.x + s * 0.08, by - small * 0.2 - (lines.length - 1 - i) * step, size, { ...place, maxWidth: maxW }));
    }
  } else if (words === 'beside') {
    if (doc.cells.caption) {
      const cap = doc.captions[part.id];
      if (cap) styled(g, doc, 'cellWords', cap, box.x + W * 0.018, box.y + box.h - W * 0.02 - lift, W * 0.022, { face: FACES[doc.font], colour: ON_MEDIA, shadow: true, maxWidth: box.w - W * 0.036 });
    }
    if (pic.kind === 'video' && doc.cells.videoBadge) {
      const r = W * 0.024;
      g.fillStyle = 'rgba(16,15,13,0.55)';
      g.beginPath();
      g.arc(box.x + box.w - r * 1.6, box.y + r * 1.6, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ON_MEDIA;
      g.beginPath();
      g.moveTo(box.x + box.w - r * 1.9, box.y + r * 1.15);
      g.lineTo(box.x + box.w - r * 1.1, box.y + r * 1.6);
      g.lineTo(box.x + box.w - r * 1.9, box.y + r * 2.05);
      g.closePath();
      g.fill();
    }
  }
  if (pill) drawPinPill(g, pill);
  g.restore();

  // What rings a cell: today, the clip playing in turn.
  const ringed = part.today || (playing !== null && doc.motion.videos === 'turn');
  if (ringed && look.alpha > 0) {
    g.save();
    g.strokeStyle = part.today && playing === null ? (light ? PAPER_INK : ON_MEDIA) : ACCENT;
    if (part.today && part.words === 'beside') g.strokeStyle = ACCENT;
    g.lineWidth = Math.max(2, W * 0.003);
    const o = g.lineWidth;
    roundRect(g, { x: box.x - o, y: box.y - o, w: box.w + 2 * o, h: box.h + 2 * o }, radius + o);
    g.stroke();
    g.restore();
  }
}

/** The style role a laid-out text part wears. */
export function roleOfPart(part: TextPart): TextRole {
  // The running head is the title, small: it wears the heading's style.
  return part.role === 'header' ? 'weekdays' : part.role === 'running' || part.role === 'quote' ? 'heading' : part.role;
}

function drawText(g: Ctx2D, doc: RecapDoc, part: TextPart, plan: PagePlan, t: number, light: boolean, bleed: boolean): void {
  const span = part.role === 'heading' ? plan.heading : part.role === 'subheading' ? plan.subheading : part.role === 'cta' ? plan.cta : plan.heading;
  const look = textLook(part.role === 'header' ? (doc.motion.title === 'none' ? 'none' : 'fade') : doc.motion.title, span, t);
  if (look.alpha <= 0) return;
  const role = roleOfPart(part);
  const st = textStyleOf(doc.texts, role);
  const ink = light && !bleed ? PAPER_INK : ON_MEDIA;
  const face = part.face === 'mono' ? MONO : FACES[doc.font];
  const upper = st.upper ?? part.upper;
  let value = upper ? part.text.toUpperCase() : part.text;
  if (look.chars < 1) value = value.slice(0, Math.round(value.length * look.chars));
  const b = part.box;
  const x = part.align === 'center' ? b.x + b.w / 2 : part.align === 'right' ? b.x + b.w : b.x;
  const y = b.y + b.h * 0.8 + look.dy * b.h;
  g.save();
  g.globalAlpha = look.alpha;
  if (look.reveal < 1) {
    g.beginPath();
    const w = b.w * look.reveal;
    const x0 = part.align === 'center' ? b.x + (b.w - w) / 2 : b.x;
    g.rect(x0, b.y - b.h, w, b.h * 3);
    g.clip();
  }
  // The part's size already carries the role's (the layout sized its box with it): drawn at 1.
  const asLaid = { ...st, size: 1 };
  const drawn = { ...doc, texts: { ...doc.texts, [role]: st === DEFAULT_TEXT_STYLE ? st : asLaid } };
  if (part.role === 'cta') {
    g.font = `500 ${part.size}px ${familyOf(st, face)}`;
    setSpacing(g, 0, part.size);
    const w = Math.min(b.w, g.measureText(value).width + part.size * 2.6);
    const pill = { x: b.x + (b.w - w) / 2, y: b.y, w, h: b.h };
    g.fillStyle = light && !bleed ? PAPER_INK : 'rgba(16,15,13,0.55)';
    roundRect(g, pill, b.h / 2);
    g.fill();
    g.fillStyle = ACCENT;
    g.beginPath();
    g.arc(pill.x + part.size * 1.1, pill.y + b.h / 2, part.size * 0.28, 0, Math.PI * 2);
    g.fill();
    styled(g, drawn, role, value, pill.x + w / 2 + part.size * 0.35, pill.y + b.h / 2, part.size, { face, colour: ON_MEDIA, align: 'center', baseline: 'middle', weight: 500, upper: false });
  } else {
    styled(g, drawn, role, value, x, y, part.size, {
      face,
      colour: ink,
      align: part.align,
      spacing: part.tracking,
      weight: 400,
      upper: false,
      shadow: bleed || doc.background.kind === 'video' || doc.background.kind === 'blur',
    });
  }
  g.restore();
}

/**
 * Paint page `opts.page` of the recap at film time `opts.t`, at the context's
 * own size: the layout's 1080-wide page is scaled to `width`.
 */
export function paintRecap(
  g: Ctx2D,
  width: number,
  doc: RecapDoc,
  resolved: ResolvedRecap,
  layout: RecapLayout,
  film: FilmPlan,
  src: PaintSources,
  opts: PaintOptions,
): void {
  const page = layout.pages[Math.min(opts.page, layout.pages.length - 1)];
  const plan = film.pages[Math.min(opts.page, film.pages.length - 1)];
  if (!page || !plan) return;
  // Every picture and video frame is scaled here — a 4K original down, a print up: the canvas's best filter, never
  // its default «low» (aliasing that shimmers in motion, softness up close).
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const k = width / page.width;
  const t = opts.t;
  g.save();
  g.setTransform(k, 0, 0, k, 0, 0);
  background(g, doc, resolved, page.width, page.height, t, src);
  const light = isLightGround(doc);
  if (doc.template === 'sheets' && opts.pan && layout.pages.length > 1) {
    // The Reel of a Sheet: the camera between two slides, each drawn at its place and clipped to itself, so a picture
    // across the cut joins seamlessly. A slide past the cover is already laid when it slides in.
    // The camera reads the recap's own time: an opener's seconds come before its first slide.
    const lead = film.lead ?? 0;
    const v = sheetView(film.pages.map((p) => ({ start: p.start - lead, length: p.length })), film.total - lead, t - lead, doc.sheet.camera);
    drawPage(g, doc, resolved, layout, film, src, opts, v.page, v.page > 0 ? Math.max(t, film.pages[v.page].allOn + 0.01) : t, -v.frac * page.width, light);
    if (v.frac > 0) drawPage(g, doc, resolved, layout, film, src, opts, v.page + 1, Math.max(t, film.pages[v.page + 1].allOn + 0.01), (1 - v.frac) * page.width, light);
  } else drawPage(g, doc, resolved, layout, film, src, opts, Math.min(opts.page, layout.pages.length - 1), t, 0, light);
  g.restore();
}

/** One page's decor, cells and words, `dx` along — clipped to the page, so a slice of a Sheet draws its own half only. */
function drawPage(g: Ctx2D, doc: RecapDoc, resolved: ResolvedRecap, layout: RecapLayout, film: FilmPlan, src: PaintSources, opts: PaintOptions, index: number, t: number, dx: number, light: boolean): void {
  const page = layout.pages[index];
  const plan = film.pages[Math.min(index, film.pages.length - 1)];
  if (!page || !plan) return;
  g.save();
  g.translate(dx, 0);
  g.beginPath();
  g.rect(0, 0, page.width, page.height);
  g.clip();
  for (const d of page.sheet?.decor ?? []) drawDecor(g, d, page.width, light);
  const slots = new Map(resolved.slots.map((s) => [s.id, s]));
  let cells = page.parts.filter((p): p is CellPart => p.kind === 'cell');
  // A week's bands in motion (lab 8): each band its box, veil and drift at this moment; the one over the others last.
  const looks = new Map<string, { dim: number; pan: number }>();
  if (doc.template === 'week' && page.key === 'first' && (plan.bands || doc.motion.bandPan)) {
    const order = [...cells].sort((a, b) => a.index - b.index);
    const at = bandsAt(doc.motion.bands, order.map((c) => c.box), page.width, page.height, plan.bands ?? null, t, doc.motion.bandPan);
    const moved = order.map((c, k) => ({ ...c, box: at[k].box, top: at[k].top }));
    order.forEach((c, k) => looks.set(c.id, { dim: at[k].dim, pan: at[k].pan }));
    cells = [...moved.filter((c) => !c.top), ...moved.filter((c) => c.top)];
  }
  // A zooming clip is drawn last, over its neighbours.
  const zooming = doc.motion.videos === 'zoom' ? cells.filter((c) => (plan.clips.get(c.id) ?? []).some((w) => t > w.from && t < w.to)) : [];
  const marks = doc.places.cells === 'off' ? null : cellMarks(doc, resolved, layout);
  const pinOf = (c: CellPart) => {
    const name = marks?.get(c.id);
    return name ? { name, bleed: page.bleed } : null;
  };
  // This page's own words (lab 17): the first slide's, the family's, the slide's — and the highlights' date style.
  const pageDoc = docOn(doc, page.key);
  const dateRole: TextRole = inFamily(page.key) ? 'flowDate' : 'dayNumber';
  for (const c of cells) if (!zooming.includes(c)) drawCell(g, pageDoc, c, slots.get(c.id), plan, t, page.width, page.height, src, opts, light && !page.bleed, looks.get(c.id) ?? null, pinOf(c), dateRole);
  for (const p of page.parts) if (p.kind === 'text') drawText(g, doc, p, plan, t, light, page.bleed);
  for (const c of zooming) drawCell(g, pageDoc, c, slots.get(c.id), plan, t, page.width, page.height, src, opts, light && !page.bleed, null, pinOf(c), dateRole);
  if (page.runs?.length) drawRuns(g, doc, page, cells, plan, t, light && !page.bleed);
  g.restore();
}

/** What a Sheet draws behind its pictures: a film strip's band and its sprocket holes, the timeline's line, their marks. */
function drawDecor(g: Ctx2D, decor: SheetDecorItem, W: number, light: boolean): void {
  if (decor.kind === 'bars') {
    const n = decor.values.length;
    const peak = Math.max(1, ...decor.values);
    const step = (decor.x1 - decor.x0) / Math.max(1, n);
    const top = decor.values.indexOf(Math.max(...decor.values));
    for (let i = 0; i < n; i++) {
      const h = Math.max(decor.h * 0.02, (decor.values[i] / peak) * decor.h);
      g.fillStyle = i === top ? ACCENT : light ? 'rgba(27,24,19,0.35)' : 'rgba(244,240,231,0.35)';
      g.fillRect(decor.x0 + i * step + step * 0.15, decor.y + decor.h - h, step * 0.7, h);
    }
    return;
  }
  if (decor.kind === 'marks') {
    g.fillStyle = decor.colour === 'film' ? 'rgba(232,170,60,0.9)' : light ? 'rgba(27,24,19,0.7)' : 'rgba(244,240,231,0.75)';
    g.font = `500 ${Math.max(6, Math.round(decor.size))}px ${MONO}`;
    g.textAlign = decor.colour === 'film' ? 'left' : 'center';
    g.textBaseline = 'alphabetic';
    for (const m of decor.marks) if (m.x > -W * 0.3 && m.x < W) g.fillText(m.text, m.x, m.y);
    g.textAlign = 'left';
    return;
  }
  const from = Math.max(0, decor.x0);
  const to = Math.min(W, decor.x1);
  if (from >= to) return;
  if (decor.kind === 'band') {
    g.fillStyle = '#0b0a08';
    g.fillRect(from, decor.y, to - from, decor.h);
    const hole = decor.h * 0.045;
    const step = hole * 2.6;
    g.fillStyle = 'rgba(244,240,231,0.6)';
    // Holes on a grid of the SHEET, so they run on across a cut.
    for (let x = from + ((step - ((from - decor.x0) % step)) % step); x < to; x += step) {
      g.fillRect(x, decor.y + hole * 0.8, hole * 1.3, hole);
      g.fillRect(x, decor.y + decor.h - hole * 1.8, hole * 1.3, hole);
    }
    return;
  }
  g.strokeStyle = light ? 'rgba(27,24,19,0.45)' : 'rgba(244,240,231,0.45)';
  g.lineWidth = Math.max(1, W * 0.002);
  g.beginPath();
  g.moveTo(from, decor.y);
  g.lineTo(to, decor.y);
  g.stroke();
}

/** The page's height at `width`, for a canvas sized to draw it. */
export function pageHeightAt(layout: RecapLayout, width: number): number {
  const p = layout.pages[0];
  return p ? Math.round((p.height / p.width) * width) : width;
}

/**
 * The first slide's title over a clip's own slide (carousel lab, E): as a
 * running head with the slide's number, or as big as on the first, on a
 * shade so it reads over any video — nothing when the title stays on the
 * first slide only. The page's slides carry it as parts (`recap-layout.ts`).
 */
export function paintSlideTitle(g: Ctx2D, doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number, n: number, of: number): void {
  const titles = doc.carousel.titles;
  if (titles === 'first' || !doc.heading.show) return;
  const text = fillText(doc.heading.text, resolved.vars);
  const m = Math.round(W * 0.06);
  const shade = g.createLinearGradient(0, 0, 0, H * 0.22);
  shade.addColorStop(0, 'rgba(10,8,6,0.55)');
  shade.addColorStop(1, 'rgba(10,8,6,0)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H * 0.22);
  if (titles === 'head') {
    const size = W * 0.026;
    styled(g, doc, 'heading', `${text} · ${n}/${of}`, m, Math.round(m * 0.18) + sizeIn(doc, 'heading', size) * 1.05, size, { face: MONO, colour: ON_MEDIA, spacing: 0.08, upper: true, maxWidth: W - 2 * m });
  } else {
    const size = W * (doc.font === 'serif' ? 0.1 : doc.font === 'mono' ? 0.052 : 0.062);
    styled(g, doc, 'heading', text, m, m + sizeIn(doc, 'heading', size) * 0.95, size, { face: FACES[doc.font], colour: ON_MEDIA, upper: doc.font === 'sans', spacing: doc.font === 'sans' ? 0.06 : 0, maxWidth: W - 2 * m });
  }
}

