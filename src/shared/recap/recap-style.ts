/**
 * A template's STYLE kept on the device — «Keep as my style» (from the list
 * he validated, 2026-11-05): how a recap LOOKS, so the next recap of the same
 * template starts from it instead of the recipe. A style is everything but
 * the content: its format and grid, its words and their styles, the
 * background's kind and treatment, the cells, the motion, the look, the
 * length and the delivery. Never a picture, a pick, a caption, a day, a clip
 * nor a sound — those belong to one recap.
 *
 * Pure.
 */

import { readRecapDoc, withRecap, type RecapDoc, type RecapTemplate } from './recap-doc';

/** The fields a style carries, as written on the device. */
export interface RecapStyle {
  template: RecapTemplate;
  format: RecapDoc['format'];
  grid: RecapDoc['grid'];
  count: RecapDoc['count'];
  rungs: RecapDoc['rungs'];
  heading: RecapDoc['heading'];
  subheading: RecapDoc['subheading'];
  cta: RecapDoc['cta'];
  font: RecapDoc['font'];
  texts: RecapDoc['texts'];
  headingOffset: RecapDoc['headingOffset'];
  /** The ground's kind and treatment — never its clip, loop nor framing (those are a picture's). */
  background: Pick<RecapDoc['background'], 'kind' | 'colour' | 'veil' | 'blur' | 'speed'>;
  cells: RecapDoc['cells'];
  /** Without its seed: each recap draws its own random order. */
  motion: Omit<RecapDoc['motion'], 'seed'>;
  look: RecapDoc['look'];
  clipSlides: RecapDoc['clipSlides'];
  length: RecapDoc['length'];
  delivery: RecapDoc['delivery'];
  /** The opener's kind and dress — never its picture, its words nor its trip (those are this recap's). */
  opener?: Omit<RecapDoc['opener'], 'picture' | 'title' | 'trip'>;
}

export const styleKey = (template: RecapTemplate) => `style:${template}`;

/** The style of `doc`, ready to keep. */
export function styleOf(doc: RecapDoc): RecapStyle {
  const { kind, colour, veil, blur, speed } = doc.background;
  const { seed: _seed, ...motion } = doc.motion;
  void _seed;
  return {
    template: doc.template,
    format: doc.format,
    grid: doc.grid,
    count: doc.count,
    rungs: [...doc.rungs],
    heading: doc.heading,
    subheading: doc.subheading,
    cta: doc.cta,
    font: doc.font,
    texts: doc.texts,
    headingOffset: doc.headingOffset,
    // A video ground with no clip of the next recap's would read as ink: kept as its kind all the same, the drawer then offers the clips.
    background: { kind, colour, veil, blur, speed },
    cells: doc.cells,
    motion,
    look: doc.look,
    clipSlides: doc.clipSlides,
    length: doc.length,
    delivery: doc.delivery,
    opener: openerStyle(doc.opener),
  };
}

function openerStyle(o: RecapDoc['opener']): RecapStyle['opener'] {
  const { picture: _p, title: _t, trip: _r, ...rest } = o;
  void _p;
  void _t;
  void _r;
  return rest;
}

/**
 * `doc` dressed in `style`, read back through the document's own reader (an
 * old or tampered style clamps like any recap). A style of another template
 * changes nothing.
 */
export function withStyle(doc: RecapDoc, style: unknown, now: number = Date.now()): RecapDoc {
  if (!style || typeof style !== 'object') return doc;
  const s = style as Partial<RecapStyle>;
  if (s.template !== doc.template) return doc;
  const merged = {
    ...doc,
    ...(s.format !== undefined ? { format: s.format } : {}),
    ...(s.grid !== undefined ? { grid: s.grid } : {}),
    ...(s.count !== undefined ? { count: s.count } : {}),
    ...(s.rungs !== undefined ? { rungs: s.rungs } : {}),
    ...(s.heading !== undefined ? { heading: s.heading } : {}),
    ...(s.subheading !== undefined ? { subheading: s.subheading } : {}),
    ...(s.cta !== undefined ? { cta: s.cta } : {}),
    ...(s.font !== undefined ? { font: s.font } : {}),
    ...(s.texts !== undefined ? { texts: s.texts } : {}),
    ...(s.headingOffset !== undefined ? { headingOffset: s.headingOffset } : {}),
    background: { ...doc.background, ...(s.background ?? {}) },
    ...(s.cells !== undefined ? { cells: s.cells } : {}),
    motion: { ...doc.motion, ...(s.motion ?? {}), seed: doc.motion.seed },
    ...(s.look !== undefined ? { look: s.look } : {}),
    ...(s.clipSlides !== undefined ? { clipSlides: s.clipSlides } : {}),
    ...(s.length !== undefined ? { length: s.length } : {}),
    ...(s.delivery !== undefined ? { delivery: s.delivery } : {}),
    opener: { ...doc.opener, ...(s.opener ?? {}), picture: doc.opener.picture, title: doc.opener.title, trip: doc.opener.trip },
  };
  const read = readRecapDoc(merged, doc.sourceId, now);
  if (!read) return doc;
  const { id: _id, createdAt: _c, ...rest } = read;
  void _id;
  void _c;
  return withRecap(doc, rest, now);
}

/** True when `doc` looks exactly as `style` — what the button says («Kept as your style»). */
export function hasStyle(doc: RecapDoc, style: unknown): boolean {
  if (!style || typeof style !== 'object') return false;
  return JSON.stringify(styleOf(doc)) === JSON.stringify(styleOf(withStyle(doc, style, doc.updatedAt)));
}
