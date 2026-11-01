/**
 * The OBJECTS of a post — what the Studio lists, selects and sets: a scene,
 * its title, its caption, the HUD, a counter's number… Each is drawn inside
 * `obj()`, which gives it a KEY (`counter.number`), a place on the stage
 * (its anchor) and the author's settings for it: where it sits, its size and
 * turn, its opacity, its typography, its outline and shadow, and a delay.
 *
 * Settings are kept in the private script at two levels, the series' and a
 * post's own (`look.objects`, `posts[id].objects`), by key: the post wins,
 * and an object unset keeps its code's own look. The CHARTE — the palette's
 * six tokens, the four font roles and two weights — is the series'.
 *
 * Typography reaches every text drawn inside an object without the block
 * knowing: `motion.ts`'s `font()` and `text()` read the object being drawn
 * (`currentStyle`). A block that names no part is still one object, its
 * scene. Nothing here touches the DOM; the canvas is the caller's.
 */
import { PAL, TYPO } from './charte';
import { DEFAULT_ROLES, FONT_ROLES, isStoryFont, nearestWeight, STORY_FONTS, type FontRole, type StoryFontId } from './fonts';

// ---- the charte -------------------------------------------------------------

export type PaletteKey = keyof typeof PAL;
export const PALETTE_KEYS = Object.keys(PAL) as PaletteKey[];
export const PALETTE_LABEL: Record<PaletteKey, string> = { bg: 'Ground', ink: 'Ink', acc: 'Accent', dim: 'Muted', soft: 'Soft', deep: 'Deep' };
const PALETTE_DEFAULT = { ...PAL };

export interface Charte {
  palette?: Partial<Record<PaletteKey, string>>;
  fonts?: Partial<Record<FontRole, StoryFontId>>;
  /** The titles' weight (the charte's 600) and the light text's (300). */
  titleWeight?: number;
  lightWeight?: number;
}

let ROLES: Record<FontRole, StoryFontId> = { ...DEFAULT_ROLES };
let WEIGHTS = { title: TYPO.hw, light: TYPO.lw };

/** Set the series' charte for the frames that follow: the palette's tokens, the font roles, the weights. */
export function applyCharte(charte: Charte | null | undefined): void {
  Object.assign(PAL, PALETTE_DEFAULT, charte?.palette ?? {});
  ROLES = { ...DEFAULT_ROLES, ...(charte?.fonts ?? {}) };
  WEIGHTS = { title: charte?.titleWeight ?? TYPO.hw, light: charte?.lightWeight ?? TYPO.lw };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** A colour as an object or the charte names it: a palette token (`@acc`) or a hex. */
export function colorOf(ref: string | undefined, fallback: string): string {
  if (!ref) return fallback;
  if (ref.startsWith('@')) return PAL[ref.slice(1) as PaletteKey] ?? fallback;
  return HEX.test(ref) ? ref : fallback;
}

// ---- an object's settings ----------------------------------------------------

export type TextCase = 'as' | 'upper' | 'lower';

export interface ObjectStyle {
  hidden?: boolean;
  /** Moved by, in the frame's pixels (1080 × 1920). */
  dx?: number;
  dy?: number;
  /** Size, 1 = as drawn. */
  scale?: number;
  /** Turn, degrees. */
  rotate?: number;
  /** 0–1, over what the object draws itself. */
  opacity?: number;
  /** A font role (`@title`, `@text`, `@num`, `@hand`) or a face (`STORY_FONTS`). */
  font?: string;
  weight?: number;
  /** The text's size, % of what the block asks. */
  size?: number;
  /** Letter spacing, px. */
  tracking?: number;
  /** A palette token or a hex. */
  color?: string;
  textCase?: TextCase;
  /** An outline around the letters, px, and its colour. */
  outline?: number;
  outlineColor?: string;
  /** A shadow under everything the object draws: its blur (0 = none), drop, opacity and colour. */
  shadow?: number;
  shadowY?: number;
  shadowOpacity?: number;
  shadowColor?: string;
  /** Seconds the object waits before it arrives. */
  delay?: number;
}

export type StyleBook = Record<string, ObjectStyle>;

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const color = (v: unknown) => (typeof v === 'string' && (HEX.test(v) || (v.startsWith('@') && v.slice(1) in PAL)) ? v : undefined);
const fontRef = (v: unknown) =>
  typeof v === 'string' && ((v.startsWith('@') && (FONT_ROLES as readonly string[]).includes(v.slice(1))) || isStoryFont(v)) ? v : undefined;

/** One object's settings, kept field by field when well formed. (pure) */
export function readStyle(raw: unknown): ObjectStyle | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ObjectStyle = {
    hidden: r.hidden === true ? true : undefined,
    dx: num(r.dx, -2000, 2000),
    dy: num(r.dy, -3000, 3000),
    scale: num(r.scale, 0.1, 5),
    rotate: num(r.rotate, -180, 180),
    opacity: num(r.opacity, 0, 1),
    font: fontRef(r.font),
    weight: num(r.weight, 100, 900),
    size: num(r.size, 20, 400),
    tracking: num(r.tracking, -10, 60),
    color: color(r.color),
    textCase: r.textCase === 'upper' || r.textCase === 'lower' || r.textCase === 'as' ? r.textCase : undefined,
    outline: num(r.outline, 0, 30),
    outlineColor: color(r.outlineColor),
    shadow: num(r.shadow, 0, 80),
    shadowY: num(r.shadowY, -60, 60),
    shadowOpacity: num(r.shadowOpacity, 0, 1),
    shadowColor: color(r.shadowColor),
    delay: num(r.delay, -10, 10),
  };
  for (const k of Object.keys(out) as (keyof ObjectStyle)[]) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** A book of settings by object key; keys are dotted names (`counter.number`). (pure) */
export function readStyleBook(raw: unknown): StyleBook | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const out: StyleBook = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(k)) continue;
    const s = readStyle(v);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The series' charte, kept when well formed. (pure) */
export function readCharte(raw: unknown): Charte | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Charte = {};
  if (typeof r.palette === 'object' && r.palette) {
    const palette: Partial<Record<PaletteKey, string>> = {};
    for (const k of PALETTE_KEYS) {
      const v = (r.palette as Record<string, unknown>)[k];
      if (typeof v === 'string' && HEX.test(v)) palette[k] = v.toLowerCase();
    }
    if (Object.keys(palette).length) out.palette = palette;
  }
  if (typeof r.fonts === 'object' && r.fonts) {
    const fonts: Partial<Record<FontRole, StoryFontId>> = {};
    for (const role of FONT_ROLES) {
      const v = (r.fonts as Record<string, unknown>)[role];
      if (isStoryFont(v)) fonts[role] = v;
    }
    if (Object.keys(fonts).length) out.fonts = fonts;
  }
  const tw = num(r.titleWeight, 100, 900);
  if (tw !== undefined) out.titleWeight = tw;
  const lw = num(r.lightWeight, 100, 900);
  if (lw !== undefined) out.lightWeight = lw;
  return Object.keys(out).length ? out : undefined;
}

// ---- the frame: whose settings, which objects were drawn ---------------------

let SERIES: StyleBook = {};
let POST: StyleBook = {};
/** Set the settings the frames that follow read: the series' and the post's own. */
export function setStyles(series: StyleBook | null | undefined, post: StyleBook | null | undefined): void {
  SERIES = series ?? {};
  POST = post ?? {};
}

/** An object's settings as drawn: the series' under the post's. (pure over the books set) */
export const styleOf = (key: string): ObjectStyle => ({ ...(SERIES[key] ?? {}), ...(POST[key] ?? {}) });

/** One object met while a frame was drawn: its instance (`slot:key`), its key, whether it set text. */
export interface DrawnObject {
  id: string;
  key: string;
  slot: string;
  text: boolean;
}

let SLOT = '';
let DRAWN: DrawnObject[] = [];
let HIDE: string | null = null;
/** Start a frame's list of objects. */
export function beginFrame(): void {
  DRAWN = [];
  SLOT = '';
}
/** The slot the next objects belong to (`compose.ts`, its key), '' for what sits over every slot. */
export function setSlot(key: string): void {
  SLOT = key;
}
/** The objects the last frame drew, in drawing order — the last on top. */
export const drawnObjects = (): readonly DrawnObject[] => DRAWN;
/** Leave one instance out of the frames that follow (what picking compares against), or none. */
export function hideObject(id: string | null): void {
  HIDE = id;
}

/** The object being drawn — what `font()` and `text()` read — and the stack of those around it. */
interface Drawing {
  style: ObjectStyle;
  record: DrawnObject;
}
const STACK: Drawing[] = [];
/** The typography in force: the innermost object's over its parents'. */
export function currentStyle(): ObjectStyle | null {
  if (!STACK.length) return null;
  let merged: ObjectStyle = {};
  for (const d of STACK) {
    const { font, weight, size, tracking, color, textCase, outline, outlineColor } = d.style;
    merged = { ...merged, ...defined({ font, weight, size, tracking, color, textCase, outline, outlineColor }) };
  }
  return merged;
}
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Draw an object: `key` names it for the settings, `anchor` is the point it
 * turns and grows about (its middle, in the frame's pixels), and `draw` gets
 * the local time less the object's delay. `from` is when it starts to show,
 * on that delayed clock: before it, the object is neither drawn nor listed,
 * so the timeline's bar starts where it appears. Hidden, or left out for
 * picking, it draws nothing.
 */
export function obj(
  c: CanvasRenderingContext2D,
  key: string,
  anchor: readonly [number, number],
  lt: number,
  draw: (lt: number) => void,
  from?: number,
): void {
  const id = `${SLOT}:${key}`;
  const style = styleOf(key);
  if (from !== undefined && lt - (style.delay ?? 0) <= from) return;
  const record: DrawnObject = { id, key, slot: SLOT, text: false };
  DRAWN.push(record);
  if (style.hidden || HIDE === id) return;
  c.save();
  const [ax, ay] = anchor;
  if (style.dx || style.dy) c.translate(style.dx ?? 0, style.dy ?? 0);
  if ((style.scale !== undefined && style.scale !== 1) || style.rotate) {
    c.translate(ax, ay);
    if (style.rotate) c.rotate((style.rotate * Math.PI) / 180);
    if (style.scale !== undefined) c.scale(style.scale, style.scale);
    c.translate(-ax, -ay);
  }
  if (style.opacity !== undefined) c.globalAlpha *= style.opacity;
  if (style.shadow) {
    const a = style.shadowOpacity ?? 0.3;
    c.shadowBlur = style.shadow;
    c.shadowOffsetY = style.shadowY ?? 8;
    c.shadowColor = withAlpha(colorOf(style.shadowColor, '#000000'), a);
  }
  STACK.push({ style, record });
  try {
    draw(lt - (style.delay ?? 0));
  } finally {
    STACK.pop();
    c.restore();
  }
}

/** Mark the objects around as holding text (the inspector then offers typography). */
export function markText(): void {
  for (const d of STACK) d.record.text = true;
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---- fonts, as `motion.ts` asks for them ------------------------------------

const BASE_SANS = TYPO.fam;
const BASE_MONO = TYPO.mono;
const familyOf = (id: StoryFontId) => STORY_FONTS[id];

/**
 * The CSS font for text drawn at `size`, weight `w`, in `fam` — as the
 * charte and the object being drawn say. The code's own sans is the charte's
 * TITLE face at title weights and its TEXT face below; its mono is the
 * NUMBERS face. An object's font, weight and size win over both.
 */
export function resolveFont(size: number, w: number, fam: string): string {
  const s = STACK.length ? currentStyle() : null;
  let id: StoryFontId | null = null;
  // The face the code itself names: the charte keeps it unless a role or the object says otherwise.
  const native: StoryFontId | null = fam === BASE_SANS ? 'geist' : fam === BASE_MONO ? 'mono' : null;
  if (fam === BASE_SANS) id = ROLES[w >= 500 ? 'title' : 'text'];
  else if (fam === BASE_MONO) id = ROLES.num;
  if (s?.font) id = s.font.startsWith('@') ? ROLES[s.font.slice(1) as FontRole] : (s.font as StoryFontId);
  let weight = w === TYPO.hw ? WEIGHTS.title : w === TYPO.lw ? WEIGHTS.light : w;
  if (s?.weight) weight = s.weight;
  const px = Math.max(1, size * ((s?.size ?? 100) / 100));
  if (!id) return `${weight} ${px}px ${fam}`;
  const f = familyOf(id);
  // A face chosen in the Studio is asked at a weight it ships (no synthetic bold of a one-weight face);
  // the code's own face keeps the weight asked, so a glyph it lacks falls back exactly as before.
  const shown = id === native ? weight : nearestWeight(f, weight);
  return `${'italic' in f && f.italic ? 'italic ' : ''}${shown} ${px}px ${f.family}`;
}
