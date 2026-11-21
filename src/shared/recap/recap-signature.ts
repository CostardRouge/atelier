import { placeOf, signedSlides, type SignatureStyle } from '../signature/signature';
import { REEL_SAFE, type SignaturePaint } from '../signature/signature-paint';
import type { RecapDoc } from './recap-doc';

/** The tool as a signature names it. */
export const RECAP_SIGNS_AS = 'Recap';

/**
 * A recap's mark as the painter takes it, or null when the recap is not
 * signed. A 9:16 page keeps it clear of where a Reel's own interface covers
 * the frame (the stage's hatched bands) — until it is placed by hand.
 */
export function recapMark(doc: RecapDoc, style: SignatureStyle, slide?: string | null): SignaturePaint | null {
  if (!doc.signature.on) return null;
  // A slide the mark was dragged on keeps its own place (`slide` is its key: a page's, `opener`, a clip slide's).
  return { face: style.face, words: style.words, tool: RECAP_SIGNS_AS, corner: doc.signature.corner, safe: doc.format === 'story' ? REEL_SAFE : null, at: placeOf(doc.signature, slide) };
}

/** Which of a recap's `count` slides — its pages as stills, or a carousel's slides in their order — wear the mark. */
export function recapSignedSlides(doc: RecapDoc, count: number): Set<number> {
  return doc.signature.on ? signedSlides(count, doc.signature.slides) : new Set();
}
