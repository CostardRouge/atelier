/**
 * How an element's pixels MIX with the picture under them.
 *
 * A short list, curated rather than the browser's full set: the modes that
 * read over a photograph and that a person can predict — words that stain a
 * dune (multiply), lift out of a night sky (screen), sink into a texture
 * (overlay, soft light), invert against it (difference), or take only its
 * light (luminosity). The rest of Canvas 2D's composite operations are either
 * masking tools (`destination-*`, which erase rather than blend — see
 * `knockout` for the two masked looks worth having) or near-duplicates that
 * lengthen a panel without widening what can be made.
 *
 * It is applied inside `drawOverlays`' per-element `save()/restore()`, and
 * every surface draws the picture and its overlays on ONE canvas — the Trips
 * stage, the Studio's preview, every export, the frame grab — so a blend is
 * the same everywhere by construction, with nothing to keep in step.
 *
 * Pure and DOM-free.
 */

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'difference'
  | 'luminosity';

export const BLEND_MODES: readonly { id: BlendMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'Drawn over the picture, as it always was' },
  { id: 'multiply', label: 'Multiply', hint: 'Darkens — the words stain a light picture' },
  { id: 'screen', label: 'Screen', hint: 'Lightens — the words lift out of a dark one' },
  { id: 'overlay', label: 'Overlay', hint: 'Sinks into the picture’s own contrast' },
  { id: 'soft-light', label: 'Soft light', hint: 'A gentler overlay' },
  { id: 'difference', label: 'Difference', hint: 'Inverts what is under the letters' },
  { id: 'luminosity', label: 'Luminosity', hint: 'Takes the picture’s colour, the words’ light' },
];

const IDS = new Set<string>(BLEND_MODES.map((m) => m.id));

export function isBlendMode(v: unknown): v is BlendMode {
  return typeof v === 'string' && IDS.has(v);
}

/**
 * The Canvas 2D composite operation for a blend, or null to leave the context
 * as it is — `normal`, absent, and anything this build does not know (a newer
 * document, a hand edit) all draw the plain way every stored element always
 * did. The ids ARE the canvas's own names, bar `normal`.
 */
export function compositeFor(blend: unknown): GlobalCompositeOperation | null {
  return isBlendMode(blend) && blend !== 'normal' ? blend : null;
}
