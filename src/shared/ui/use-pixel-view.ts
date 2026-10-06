import { localPref, useLocalPref } from './local-pref';

/**
 * How a magnified picture is drawn: SMOOTH, or its pixels as pixels.
 *
 * It only matters past 1:1 (`PictureZoom.onePixel`), and there it matters a
 * lot. A smooth resample of a magnified pixel draws a gradient nothing
 * photographed — which is the right answer when you are judging a shape and the
 * wrong one when you are judging noise, an edge or a dust speck, because it
 * hides the very thing you zoomed in to see.
 *
 * Two choices, not three: an "auto" that switched at 1:1 would be a third mode
 * nobody asked for, and the moment a photographer wants one of these they want
 * it decided.
 *
 * A browser PREFERENCE, never a document: it is how this machine draws, like
 * the LUT interpolation mode, and it must not travel in a roll.
 */
export type PixelView = 'smooth' | 'pixels';

const KEY = 'atelier.develop.pixelView';

/** One value for every reader — the stage, the sheet and the settings page (`local-pref.ts`). */
export const pixelViewPref = localPref<PixelView>(KEY, (raw) => (raw === 'pixels' ? 'pixels' : 'smooth'), (v) => v);

/** The CSS for a canvas drawn this way. `auto` is the browser's own smoothing. */
export function imageRenderingFor(view: PixelView): 'auto' | 'pixelated' {
  return view === 'pixels' ? 'pixelated' : 'auto';
}

export function usePixelView(): [PixelView, (next: PixelView) => void] {
  return useLocalPref(pixelViewPref, 'smooth');
}
