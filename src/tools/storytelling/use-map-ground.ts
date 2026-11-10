import { useEffect, useMemo, useRef, useState } from 'react';
import { proj, type RoadPoints, type Stop } from '../../shared/story/geo';
import { groundBoxes, MAP_GROUND_DEFAULTS, seaBand, seaColour, type GroundLayer, type MapGround } from '../../shared/story/map-ground';
import { loadBasemap, useTilesAllowed } from '../../shared/map/osm-tiles';
import { toneRaster } from '../../shared/map/tile-tone';
import { deviceClass } from '../../shared/lib/device-class';

export type MapGroundState =
  | { state: 'off' }
  | { state: 'not-allowed' }
  | { state: 'loading' }
  | { state: 'ready'; layers: GroundLayer[] }
  | { state: 'failed'; message: string };

/**
 * The rasters kept for the visit, by what they were asked for — a post opened again asks nothing. Each key
 * holds two toned rasters (20–40 MB), and a tone or a route edited is a new key: the most recent few are
 * kept, by device (`performance.md` rule 4), in the Map's order (a key read is moved to its end).
 */
const kept = new Map<string, Promise<GroundLayer[]>>();
const keptMost = () => (deviceClass() === 'constrained' ? 2 : 6);

async function fetchLayers(key: string, boxes: ReturnType<typeof groundBoxes>, tone: MapGround['tone']): Promise<GroundLayer[]> {
  let pending = kept.get(key);
  if (pending) {
    kept.delete(key);
    kept.set(key, pending);
  }
  if (!pending) {
    pending = Promise.all(
      boxes.map(async ({ box, width, height, fade }) => {
        // Two rasters side by side, two tiles each: the tile server's fair share, and the wide one lands first.
        const raw = await loadBasemap(box, width, height, undefined, undefined, 2);
        const w = raw.width || width;
        const h = raw.height || height;
        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext('2d');
        if (!g) throw new Error('This browser cannot draw the map background.');
        g.drawImage(raw, 0, 0);
        raw.close();
        toneRaster(g, tone ?? MAP_GROUND_DEFAULTS.tone, w, h);
        let sea: string | null = null;
        if (fade) {
          // The open sea's colour, read before the foot fades: what the map is filled with beyond the raster.
          const [top, foot] = seaBand(h, fade);
          const band = g.getImageData(0, Math.floor(top), w, Math.max(1, Math.floor(foot) - Math.floor(top)));
          sea = seaColour(band.data, w, 0, band.height);
          // Its foot fades into the charte's ground rather than stopping on an edge.
          const from = h * (1 - fade);
          const ramp = g.createLinearGradient(0, from, 0, h);
          ramp.addColorStop(0, 'rgba(0,0,0,0)');
          ramp.addColorStop(1, 'rgba(0,0,0,1)');
          g.globalCompositeOperation = 'destination-out';
          g.fillStyle = ramp;
          g.fillRect(0, from, w, h - from);
          g.globalCompositeOperation = 'source-over';
        }
        return { image: canvas, box, ...(sea ? { sea } : {}) };
      }),
    );
    pending.catch(() => kept.delete(key));
    kept.set(key, pending);
    while (kept.size > keptMost()) kept.delete(kept.keys().next().value!);
  }
  return pending;
}

/**
 * The map ground's tiles for the post being edited (`map-ground.ts`): asked
 * only when the series draws its maps over tiles AND this device said yes
 * (`osm-tiles.ts`), for the boxes the trip's route needs, toned once, and
 * kept for the visit. `ready()` is what an export waits on — the rasters, or
 * the outline when they cannot come.
 */
export function useMapGround(
  ground: MapGround | undefined,
  stops: readonly Stop[] | null | undefined,
  road: RoadPoints | null | undefined,
): { ground: MapGroundState; ready: () => Promise<GroundLayer[] | null> } {
  const allowed = useTilesAllowed();
  const wants = ground?.ground === 'tiles';
  const tone = ground?.tone ?? MAP_GROUND_DEFAULTS.tone;
  // The route in the map's units: the road when there is one, else the stops.
  const boxes = useMemo(() => {
    if (!wants) return null;
    const line = road && road.length >= 2 ? road.map((p) => proj(p[0], p[1])) : (stops ?? []).map((s) => proj(s[1], s[2]));
    return groundBoxes(line);
  }, [wants, road, stops]);
  const key = boxes ? `${tone}|${boxes.map((b) => `${b.box.west.toFixed(3)},${b.box.south.toFixed(3)},${b.box.east.toFixed(3)},${b.box.north.toFixed(3)},${b.width}x${b.height}`).join('|')}` : null;
  const [state, setState] = useState<MapGroundState>({ state: 'off' });
  const current = useRef<Promise<GroundLayer[] | null>>(Promise.resolve(null));

  useEffect(() => {
    if (!wants || !boxes || !key) {
      setState({ state: 'off' });
      current.current = Promise.resolve(null);
      return;
    }
    if (!allowed) {
      setState({ state: 'not-allowed' });
      current.current = Promise.resolve(null);
      return;
    }
    let alive = true;
    setState({ state: 'loading' });
    const asked = fetchLayers(key, boxes, tone);
    current.current = asked.catch(() => null);
    asked
      .then((layers) => alive && setState({ state: 'ready', layers }))
      .catch((err: unknown) => alive && setState({ state: 'failed', message: err instanceof Error ? err.message : String(err) }));
    return () => {
      alive = false;
    };
    // `key` stands for the boxes and the tone.
  }, [wants, allowed, key]);

  return { ground: state, ready: () => current.current };
}
