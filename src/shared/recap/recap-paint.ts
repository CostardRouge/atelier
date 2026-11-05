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
import type { Box, CellPart, RecapLayout, TextPart } from './recap-layout';
import { cellLook, clipTime, loopTime, textLook, zoomedBox, type FilmPlan, type PagePlan } from './recap-motion';
import { deviceLabel, type DeviceAliases, type RecapSlot, type ResolvedRecap } from './recap-slots';
import { shortDate } from './recap-days';

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
const MONO = FACES.mono;

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

/** `src` drawn to cover `box` — cropped, never stretched. */
export function drawCover(g: Ctx2D, src: Drawable, box: Box): void {
  if (src.width <= 0 || src.height <= 0 || box.w <= 0 || box.h <= 0) return;
  const k = Math.max(box.w / src.width, box.h / src.height);
  const sw = box.w / k;
  const sh = box.h / k;
  g.drawImage(src.image, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
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

function text(g: Ctx2D, value: string, x: number, y: number, size: number, face: string, colour: string, opts: { weight?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; spacing?: number; shadow?: boolean } = {}): void {
  g.font = `${opts.weight ?? 400} ${Math.max(1, Math.round(size))}px ${face}`;
  g.fillStyle = colour;
  g.textAlign = opts.align ?? 'left';
  g.textBaseline = opts.baseline ?? 'alphabetic';
  setSpacing(g, opts.spacing ?? 0, size);
  if (opts.shadow) {
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = size * 0.35;
    g.shadowOffsetY = size * 0.06;
  }
  g.fillText(value, x, y);
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  setSpacing(g, 0, size);
}

/** The camera's line: `α7 IV · 35 mm · f/1.8 · 1/250 · ISO 100`. */
export function exifLine(p: RecapPicture, aliases: DeviceAliases = {}): string {
  const bits: string[] = [];
  if (p.device) bits.push(deviceLabel(p.device, aliases));
  if (p.focal) bits.push(`${Math.round(p.focal)} mm`);
  if (p.fNumber) bits.push(`f/${p.fNumber % 1 ? p.fNumber.toFixed(1) : p.fNumber}`);
  if (p.shutter) bits.push(p.shutter);
  if (p.iso) bits.push(`ISO ${p.iso}`);
  return bits.join(' · ');
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
      drawCover(g, frame, { x: 0, y: 0, w: W, h: H });
      drew = true;
    }
  } else if (bg.kind === 'blur') {
    const first = resolved.slots.find((s) => s.picture)?.picture;
    const still = first ? src.still(first.key) : null;
    if (still) {
      const f = g as Ctx2D & { filter?: string };
      const had = 'filter' in f ? f.filter : undefined;
      if (had !== undefined) f.filter = `blur(${Math.round(bg.blur * (W / 1080))}px)`;
      // Drawn a little larger than the page, so the blur's soft edge falls outside it.
      drawCover(g, still, { x: -W * 0.06, y: -H * 0.06, w: W * 1.12, h: H * 1.12 });
      if (had !== undefined) f.filter = had;
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

function slotPicture(slot: RecapSlot | undefined): RecapPicture | null {
  return slot?.picture ?? null;
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

  // The rung's words beside its picture (on this day) are drawn whatever the picture's state.
  if (words === 'beside') {
    g.globalAlpha = pic ? textLook(doc.motion.title === 'none' ? 'none' : 'fade', span ?? null, t).alpha : gridAlpha;
    const x = box.x - W * 0.27;
    const size = W * 0.034;
    text(g, part.label ?? '', x, box.y + size * 1.1, size, FACES[doc.font], part.today ? ACCENT : ink, { weight: 500 });
    let ly = box.y + box.h - W * 0.012;
    if (doc.cells.device && pic?.device) {
      text(g, deviceLabel(pic.device, opts.aliases).toUpperCase(), x, ly, W * 0.017, MONO, ink, { spacing: 0.04 });
      ly -= W * 0.028;
    }
    if (slot?.day) text(g, shortDate(slot.day).toUpperCase(), x, ly, W * 0.019, MONO, ink, { spacing: 0.04 });
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
      if (doc.cells.number) text(g, part.number, cx, box.y + box.h - H * 0.16, size, MONO, ink, { align: 'center' });
      if (part.label) text(g, part.label.toUpperCase(), cx, box.y + box.h - H * 0.16 + size * 0.9, size * 0.42, FACES.sans, ink, { align: 'center', spacing: 0.12 });
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
      if (empty !== 'hidden' && doc.cells.number && words === 'inside') text(g, part.number, box.x + s * 0.09, box.y + small * 1.2, small, FACES.sans, ink, { weight: 500 });
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
  if (doc.cells.shadow > 0) {
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
    drawCover(g, drawable, box);
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

  // The words over the picture.
  if (words === 'bottom') {
    const grad = g.createLinearGradient(0, box.y + box.h * 0.55, 0, box.y + box.h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = grad;
    g.fillRect(box.x, box.y + box.h * 0.55, box.w, box.h * 0.45);
    if (doc.template === 'week') {
      const size = Math.min(box.w * 0.42, W * 0.05);
      if (doc.cells.number) text(g, part.number, cx, box.y + box.h - H * 0.16, size, MONO, ON_MEDIA, { align: 'center' });
      if (part.label) text(g, part.label.toUpperCase(), cx, box.y + box.h - H * 0.16 + size * 0.9, size * 0.42, FACES.sans, ON_MEDIA, { align: 'center', spacing: 0.12 });
    } else {
      const lines: string[] = [];
      if (doc.cells.exif) lines.push(exifLine(pic, opts.aliases));
      else if (doc.cells.device && pic.device) lines.push(deviceLabel(pic.device, opts.aliases));
      if (doc.cells.caption && opts && slot) {
        const cap = doc.captions[part.id];
        if (cap) lines.unshift(cap);
      }
      lines.forEach((l, i) => text(g, l, box.x + W * 0.065, box.y + box.h - H * 0.06 - (lines.length - 1 - i) * W * 0.032, W * 0.021, MONO, ON_MEDIA, { spacing: 0.02 }));
    }
  } else if (words === 'inside') {
    if (doc.cells.number) text(g, part.number, box.x + s * 0.08, box.y + small * 1.15, small, FACES.sans, ON_MEDIA, { weight: 500, shadow: true });
    let by = box.y + box.h - s * 0.08;
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
    if (doc.cells.caption) {
      const cap = doc.captions[part.id];
      if (cap) text(g, cap, box.x + s * 0.08, by - small * 0.2, small * 0.9, FACES[doc.font], ON_MEDIA, { shadow: true });
    } else if (doc.cells.exif || doc.cells.device) {
      const line = doc.cells.exif ? exifLine(pic, opts.aliases) : deviceLabel(pic.device, opts.aliases);
      if (line) text(g, line, box.x + s * 0.08, by - small * 0.2, Math.max(8, small * 0.62), MONO, ON_MEDIA, { shadow: true });
    }
  } else if (words === 'beside') {
    if (doc.cells.caption) {
      const cap = doc.captions[part.id];
      if (cap) text(g, cap, box.x + W * 0.018, box.y + box.h - W * 0.02, W * 0.022, FACES[doc.font], ON_MEDIA, { shadow: true });
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

function drawText(g: Ctx2D, doc: RecapDoc, part: TextPart, plan: PagePlan, t: number, light: boolean, bleed: boolean): void {
  const span = part.role === 'heading' ? plan.heading : part.role === 'subheading' ? plan.subheading : part.role === 'cta' ? plan.cta : plan.heading;
  const look = textLook(part.role === 'header' ? (doc.motion.title === 'none' ? 'none' : 'fade') : doc.motion.title, span, t);
  if (look.alpha <= 0) return;
  const ink = light && !bleed ? PAPER_INK : ON_MEDIA;
  const face = part.face === 'mono' ? MONO : FACES[doc.font];
  let value = part.upper ? part.text.toUpperCase() : part.text;
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
  if (part.role === 'cta') {
    g.font = `500 ${part.size}px ${face}`;
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
    text(g, value, pill.x + w / 2 + part.size * 0.35, pill.y + b.h / 2, part.size, face, ON_MEDIA, { align: 'center', baseline: 'middle', weight: 500 });
  } else {
    text(g, value, x, y, part.size, face, ink, {
      align: part.align,
      spacing: part.tracking,
      weight: part.face === 'mono' ? 400 : doc.font === 'sans' ? 400 : 400,
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
  const k = width / page.width;
  const t = opts.t;
  g.save();
  g.setTransform(k, 0, 0, k, 0, 0);
  background(g, doc, resolved, page.width, page.height, t, src);
  const light = isLightGround(doc);
  const slots = new Map(resolved.slots.map((s) => [s.id, s]));
  const cells = page.parts.filter((p): p is CellPart => p.kind === 'cell');
  // A zooming clip is drawn last, over its neighbours.
  const zooming = doc.motion.videos === 'zoom' ? cells.filter((c) => (plan.clips.get(c.id) ?? []).some((w) => t > w.from && t < w.to)) : [];
  for (const c of cells) if (!zooming.includes(c)) drawCell(g, doc, c, slots.get(c.id), plan, t, page.width, page.height, src, opts, light && !page.bleed);
  for (const p of page.parts) if (p.kind === 'text') drawText(g, doc, p, plan, t, light, page.bleed);
  for (const c of zooming) drawCell(g, doc, c, slots.get(c.id), plan, t, page.width, page.height, src, opts, light && !page.bleed);
  g.restore();
}

/** The page's height at `width`, for a canvas sized to draw it. */
export function pageHeightAt(layout: RecapLayout, width: number): number {
  const p = layout.pages[0];
  return p ? Math.round((p.height / p.width) * width) : width;
}
