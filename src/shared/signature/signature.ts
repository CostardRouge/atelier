/**
 * The SIGNATURE: what an export says about where it was made — «Made with
 * Atelier · Recap» (2026-11-19, his picks on the lab
 * https://claude.ai/artifact/Divt1R8MoTts4c97PTx6cF, every recommendation).
 *
 * Two halves, kept in two places on purpose:
 *
 * - the STYLE — which face, which words — is one brand, set once for every
 *   tool and kept on the device (`signature-pref.ts`);
 * - whether a DOCUMENT is signed, in which corner, and on which slides of a
 *   carousel, is the document's (`DocSignature`, a field of each tool's own
 *   document), so its exports always agree, an agent's included, and its file
 *   carries the choice to another device.
 *
 * A still or a slide wears the face in a corner; a FILM wears nothing over
 * its pictures and closes on the end card instead (`END_CARD_SECONDS`).
 * It is not Develop's roll watermark — the author's own name on his
 * photograph (`export-targets.ts`) — which stays what it is.
 *
 * Pure and DOM-free: the painter is `signature-paint.ts`.
 */

export const SIGN_FACES = ['line', 'sticker', 'stamp', 'corner'] as const;
export type SignFace = (typeof SIGN_FACES)[number];
export const SIGN_FACE_LABEL: Record<SignFace, string> = { line: 'Line', sticker: 'Sticker', stamp: 'Stamp', corner: 'Corner' };

/** What it says: the brand alone, the tool after it, or the tool and the site's address. */
export const SIGN_WORDS = ['made', 'tool', 'address'] as const;
export type SignWords = (typeof SIGN_WORDS)[number];
export const SIGN_WORDS_LABEL: Record<SignWords, string> = { made: 'Made with Atelier', tool: '+ the tool', address: '+ the address' };

export const SIGN_CORNERS = ['tl', 'tr', 'bl', 'bc', 'br'] as const;
export type SignCorner = (typeof SIGN_CORNERS)[number];
export const SIGN_CORNER_LABEL: Record<SignCorner, string> = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', bc: 'Bottom', br: 'Bottom right' };

/** Which slides of several wear it. */
export const SIGN_SLIDES = ['last', 'every', 'ends'] as const;
export type SignSlides = (typeof SIGN_SLIDES)[number];
export const SIGN_SLIDES_LABEL: Record<SignSlides, string> = { last: 'Last slide', every: 'Every slide', ends: 'First and last' };

/** Where the suite lives — the address a signature may say. */
export const SIGN_ADDRESS = 'atelier.steeve.website';

/** The brand's half, the same in every tool. */
export interface SignatureStyle {
  face: SignFace;
  words: SignWords;
}
export const DEFAULT_SIGNATURE_STYLE: SignatureStyle = { face: 'sticker', words: 'tool' };

/**
 * Where a mark was put BY HAND: its centre, as fractions of the frame's width
 * and height — so a place holds whatever size the file is written at.
 */
export interface SignPlace {
  x: number;
  y: number;
}

/** The document's half. */
export interface DocSignature {
  on: boolean;
  corner: SignCorner;
  slides: SignSlides;
  /** Dragged on the stage of a document with ONE frame (a mosaic, an atlas): wins over `corner`. */
  at?: SignPlace;
  /**
   * Dragged on one SLIDE of several (a recap's page, its opener's still), by
   * the slide's key: that slide's own place, the others keeping theirs — his
   * ask of 2026-11-21, «individuellement sur chacun des slides».
   */
  places?: Record<string, SignPlace>;
}
/** A document that never chose: signed, bottom left (above a Reel's caption), the last slide only. */
export const DEFAULT_DOC_SIGNATURE: DocSignature = { on: true, corner: 'bl', slides: 'last' };

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** A stored style back to a style; anything else is the default's. */
export function readSignatureStyle(raw: unknown): SignatureStyle {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { face: oneOf(SIGN_FACES, r.face, DEFAULT_SIGNATURE_STYLE.face), words: oneOf(SIGN_WORDS, r.words, DEFAULT_SIGNATURE_STYLE.words) };
}

/** A document's stored choice back to one; an absent or broken field is `fallback` (a tool's own default). */
export function readDocSignature(raw: unknown, fallback: DocSignature = DEFAULT_DOC_SIGNATURE): DocSignature {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const at = readPlace(r.at);
  const places: Record<string, SignPlace> = {};
  if (typeof r.places === 'object' && r.places !== null && !Array.isArray(r.places)) {
    for (const [key, raw] of Object.entries(r.places as Record<string, unknown>).slice(0, MAX_PLACES)) {
      const place = readPlace(raw);
      if (place && key.length <= 80) places[key] = place;
    }
  }
  return {
    on: typeof r.on === 'boolean' ? r.on : fallback.on,
    corner: oneOf(SIGN_CORNERS, r.corner, fallback.corner),
    slides: oneOf(SIGN_SLIDES, r.slides, fallback.slides),
    ...(at ? { at } : {}),
    ...(Object.keys(places).length ? { places } : {}),
  };
}

/** A carousel holds twenty slides at most; a document never needs more places than a few of those. */
const MAX_PLACES = 64;

const unit = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;

function readPlace(raw: unknown): SignPlace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.x !== 'number' || typeof r.y !== 'number' || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return null;
  return { x: unit(r.x), y: unit(r.y) };
}

/** Where a slide's mark was put by hand — its own place, else the document's — or null: its corner then. */
export function placeOf(sig: DocSignature, slide?: string | null): SignPlace | null {
  return (slide ? sig.places?.[slide] : undefined) ?? sig.at ?? null;
}

/** The mark dragged to `place`: on `slide` alone when one is named, else for the whole document. Signs it, too. */
export function withPlace(sig: DocSignature, place: SignPlace, slide?: string | null): DocSignature {
  const at = { x: unit(place.x), y: unit(place.y) };
  return slide ? { ...sig, on: true, places: { ...sig.places, [slide]: at } } : { ...sig, on: true, at };
}

/** A corner picked: every mark goes back to it — what was placed by hand is let go, on every slide. */
export function withCorner(sig: DocSignature, corner: SignCorner): DocSignature {
  return { on: true, corner, slides: sig.slides };
}

/** The words of one signature, in the order every face reads them. */
export interface SignatureParts {
  /** «Made with», always: the brand alone would read as a logo, not a credit. */
  lead: string;
  name: string;
  /** The tool's name, or null when the words leave it out. */
  tool: string | null;
  address: string | null;
}

export function signatureParts(words: SignWords, tool: string): SignatureParts {
  return { lead: 'Made with', name: 'Atelier', tool: words === 'made' ? null : tool, address: words === 'address' ? SIGN_ADDRESS : null };
}

/** The same words as one line — the Export line's reading, a file's caption. */
export function signatureLine(words: SignWords, tool: string): string {
  const p = signatureParts(words, tool);
  return [`${p.lead} ${p.name}`, p.tool, p.address].filter(Boolean).join(' · ');
}

/** Which of `count` slides wear the mark, as their indices. */
export function signedSlides(count: number, slides: SignSlides): Set<number> {
  const out = new Set<number>();
  if (count <= 0) return out;
  if (slides === 'every') for (let i = 0; i < count; i++) out.add(i);
  else {
    out.add(count - 1);
    if (slides === 'ends') out.add(0);
  }
  return out;
}

// ---- the end card: a film's last second -------------------------------------------------

/** How long the end card adds to a film. */
export const END_CARD_SECONDS = 1.2;

/** A cubic Bézier easing through (x1, y1) and (x2, y2), as CSS writes it. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

const CLOSE_IN = cubicBezier(0.2, 0.8, 0.2, 1);
const POP = cubicBezier(0.3, 1.6, 0.5, 1);
const RISE = cubicBezier(0, 0, 0.58, 1);
const span = (t: number, from: number, length: number) => Math.max(0, Math.min(1, (t - from) / length));

/** Where each piece of the end card stands `t` seconds into it — every number 0 → 1 (the dot overshoots). */
export interface EndCardBeat {
  /** The four corners closing in: 0 = apart and unseen, 1 = home. */
  corners: number;
  /** The dot's scale. */
  dot: number;
  /** «Made with», the name, the tool, the address — each rising in turn. */
  words: [number, number, number, number];
}

/**
 * The lab's beats — corners .7 s, the dot at .5 s, the words from .75 s —
 * played in six tenths of their time, so everything has landed a fifth of a
 * second before the film ends and its last frame is the whole card.
 */
export function endCardBeat(t: number): EndCardBeat {
  const k = 0.6;
  const word = (delay: number) => RISE(span(t, delay * k, 0.5 * k));
  return {
    corners: CLOSE_IN(span(t, 0, 0.7 * k)),
    dot: POP(span(t, 0.5 * k, 0.45 * k)),
    words: [word(0.75), word(0.85), word(1), word(1.15)],
  };
}

/** The card as it rests: what a poster of it, or a reader with motion reduced, sees. */
export const END_CARD_REST: EndCardBeat = { corners: 1, dot: 1, words: [1, 1, 1, 1] };
