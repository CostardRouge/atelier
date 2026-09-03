/**
 * Whether this browser may look a place up online.
 *
 * OFF by default, and that default is the point. Looking a place up sends the
 * text the author typed to a third party (OpenStreetMap's Nominatim), which is
 * the suite's second network exception after the opt-in map tiles — and the
 * first one carrying anything the author wrote. So it follows the tiles'
 * pattern exactly: nothing at boot, nothing implicit, one visible switch, and
 * a panel that stays fully usable with the switch off (every place can be
 * typed by hand; coordinates are optional everywhere they appear).
 *
 * It sits in `localStorage` rather than in the trip document for the reason
 * `use-lut-interpolation.ts` gives: it is a preference of this machine, not a
 * property of the journey. Storing it on the trip would mail someone else's
 * consent along with an exported `.roadtrip.json`, which it must never do.
 */

import { useCallback, useState } from 'react';

const KEY = 'atelier.roadtrip.placeSearch';

/** What the author is told before anything can leave. Rendered by the panels. */
export const PLACE_SEARCH_NOTICE =
  'Searching sends the words you type to OpenStreetMap’s Nominatim service. ' +
  'Nothing else leaves this machine — not your photos, not their positions, ' +
  'not the trip. You can always type a place by hand instead.';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    // Private mode, disabled storage — the answer stays "no", which is the
    // safe direction for a consent flag.
    return false;
  }
}

export interface PlaceSearchPref {
  /** True only when the author has explicitly turned the search on. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
}

export function usePlaceSearchPref(): PlaceSearchPref {
  const [enabled, setState] = useState<boolean>(read);

  const setEnabled = useCallback((on: boolean) => {
    setState(on);
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // Not persisting is survivable: the session still honours the choice,
      // and the next one starts from "off" again, which is the right way for
      // a consent flag to fail.
    }
  }, []);

  return { enabled, setEnabled };
}
