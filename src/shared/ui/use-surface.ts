import { useEffect } from 'react';

/**
 * Which SURFACE a screen wants under it: the paper, or the darkroom.
 *
 * A grading screen — the Studio editor, the piece editor — judges colour,
 * and warm paper beside the picture biases that judgement: the eye adapts
 * to the cream and reads the frame colder than it is (the audit's Z6, the
 * maintainer's ruling). Grading software surrounds the picture with neutral
 * grey for this reason; so does Atelier, on those two screens only. The
 * galleries, the overview and the home keep Studio Papier: the identity does
 * not vanish, it steps back where the picture must be judged.
 *
 * The switch is one attribute on `<html>` (`data-surface="darkroom"`) and the
 * same tokens redefined under it (`index.css`): no component changes. Mounts
 * are counted, so two screens asking at once do not cancel each other.
 */
export type Surface = 'darkroom';

let holders = 0;

function apply() {
  const root = document.documentElement;
  if (holders > 0) root.dataset.surface = 'darkroom';
  else delete root.dataset.surface;
}

export function useSurface(surface: Surface | null) {
  useEffect(() => {
    if (!surface) return;
    holders += 1;
    apply();
    return () => {
      holders = Math.max(0, holders - 1);
      apply();
    };
  }, [surface]);
}
