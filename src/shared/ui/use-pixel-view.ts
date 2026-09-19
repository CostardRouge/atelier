import { useCallback, useEffect, useState } from 'react';

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

function read(): PixelView {
  if (typeof localStorage === 'undefined') return 'smooth';
  try {
    return localStorage.getItem(KEY) === 'pixels' ? 'pixels' : 'smooth';
  } catch {
    // A private window, or blocked site data: the default is not an error.
    return 'smooth';
  }
}

/** The CSS for a canvas drawn this way. `auto` is the browser's own smoothing. */
export function imageRenderingFor(view: PixelView): 'auto' | 'pixelated' {
  return view === 'pixels' ? 'pixelated' : 'auto';
}

export function usePixelView(): [PixelView, (next: PixelView) => void] {
  const [view, setView] = useState<PixelView>(read);
  // Read again on mount: the first render happens before `localStorage` is
  // safe to touch during hydration, and this costs one comparison.
  useEffect(() => setView(read()), []);
  const write = useCallback((next: PixelView) => {
    setView(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* the choice still holds for this session */
    }
  }, []);
  return [view, write];
}
