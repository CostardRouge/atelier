import { useEffect, useState } from 'react';
import { landIfLoaded, loadLandIndex } from '../../shared/map/load-terrain';
import type { LandIndex } from '../../shared/map/terrain';

/**
 * The shipped coastline as a terrain index, asked for only while `wanted`:
 * the file is our own origin's and read once a session (`load-terrain.ts`),
 * and a surface that does not need it never fetches it.
 */
export function useLandIndex(wanted: boolean): LandIndex | null {
  const [land, setLand] = useState<LandIndex | null>(() => landIfLoaded());
  useEffect(() => {
    if (!wanted || land) return;
    let live = true;
    loadLandIndex()
      .then((index) => live && setLand(index))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wanted, land]);
  return land;
}
