import { useEffect, useState } from 'react';
import { ensureFontFaces } from '../../shared/overlay/fonts';
import { logosLoaded } from './atlas-logos';

/** How long the film waits for what its first seconds draw before it starts with what it has. */
export const FILM_WAIT_MS = 3000;

/**
 * Whether the film may start playing by itself: once its flights are read
 * (`armed`) AND what its first seconds draw has landed — the fonts, the
 * makers' logos, and the scene's coastline and places' names
 * (`sceneSettled`) — or `FILM_WAIT_MS` after it was armed, whatever is still
 * on its way. Measured headless: the city index handed back by its worker
 * held the main thread ~120–200 ms half a second into the intro, and the
 * place it names popped in as the intro's title; a word, a logo or a face
 * landing mid-fade is a jump on the picture. Until then the stage shows the
 * film's first frame, still.
 */
export function useFilmReady(armed: boolean, sceneSettled: boolean, faces: readonly string[]): boolean {
  const [assets, setAssets] = useState(false);
  const [late, setLate] = useState(false);
  const facesKey = faces.join('|');

  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    void Promise.all([ensureFontFaces(facesKey.split('|')), logosLoaded()]).then(() => !cancelled && setAssets(true));
    const timer = window.setTimeout(() => !cancelled && setLate(true), FILM_WAIT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [armed, facesKey]);

  return armed && (late || (assets && sceneSettled));
}
