import { useEffect, useRef, useState } from 'react';
import type { BrushRaster } from '../render/brush-raster';
import { segmentSubject, segmenterState, type SegmenterState } from '../segment/segmenter';
import { drawingLayers, type AdjustLayer } from './layer';

/**
 * The alpha map for every SUBJECT layer on the open picture, resolved by the
 * model and kept for the session.
 *
 * The raster is DERIVED data, never the document's (`render-layers.md`): what
 * is stored is the points and the model id, and this turns that request into
 * pixels. Which is why it is a hook and not a field — it is a cache with a
 * lifetime, not a value.
 *
 * Three rules it exists to hold:
 *
 * - **One inference at a time, across every layer.** The task has a single
 *   result slot; two in flight can have their answers swapped.
 * - **Keyed by the request, not by the layer.** Two layers pointing at the same
 *   subject of the same picture segment once, and nudging a slider on a layer
 *   never re-runs a four-second inference.
 * - **The last good raster stays up while a new one is computed.** A mask that
 *   blinked empty for four seconds on every added point would read as broken.
 */
export interface SubjectMasks {
  /** Layer id → its alpha map. Absent while the first answer is still coming. */
  rasters: ReadonlyMap<string, BrushRaster>;
  /** A layer whose mask is being segmented right now, or null. */
  working: string | null;
  state: SegmenterState;
}

function requestKey(pictureKey: string, model: string, points: readonly (readonly [number, number])[]): string {
  return `${pictureKey}|${model}|${points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')}`;
}

export function useSubjectMasks({
  layers,
  source,
  pictureKey,
}: {
  layers: readonly AdjustLayer[] | null | undefined;
  /** What the model is shown. Null while the picture is decoding. */
  source: TexImageSource | null;
  /** Changes when the open picture does, so one picture's masks never serve another. */
  pictureKey: string;
}): SubjectMasks {
  const [rasters, setRasters] = useState<ReadonlyMap<string, BrushRaster>>(new Map());
  const [working, setWorking] = useState<string | null>(null);
  const [state, setState] = useState<SegmenterState>(segmenterState());
  // Key → raster, for the session. Never cleared on a layer change: an undo
  // that brings a subject back must not pay for it twice.
  const cache = useRef(new Map<string, BrushRaster>());
  const runId = useRef(0);

  // The requests, as a string, so the effect below runs when they really change
  // and not when a slider moves.
  const wanted = drawingLayers(layers)
    .filter((l) => l.mask?.kind === 'subject' && l.mask.points.length > 0)
    .map((l) => {
      const mask = l.mask as { points: readonly (readonly [number, number])[]; model: string };
      return { id: l.id, key: requestKey(pictureKey, mask.model, mask.points), points: mask.points };
    });
  const signature = wanted.map((w) => `${w.id}=${w.key}`).join('|');

  useEffect(() => {
    if (!source) return;
    const run = ++runId.current;
    let cancelled = false;

    // Whatever is already cached goes up at once — including on a picture the
    // author has come back to, which is then instant.
    const ready = new Map<string, BrushRaster>();
    const missing: typeof wanted = [];
    for (const want of wanted) {
      const hit = cache.current.get(want.key);
      if (hit) ready.set(want.id, hit);
      else missing.push(want);
    }
    if (ready.size) setRasters((prev) => (sameMaps(prev, ready) ? prev : mergeKept(prev, ready, wanted)));
    if (missing.length === 0) {
      setWorking(null);
      return;
    }

    void (async () => {
      for (const want of missing) {
        if (cancelled || runId.current !== run) return;
        setWorking(want.id);
        const raster = await segmentSubject(
          source,
          want.points.map(([x, y]) => ({ x, y })),
        );
        setState(segmenterState());
        if (cancelled || runId.current !== run) return;
        if (raster) {
          cache.current.set(want.key, raster);
          setRasters((prev) => {
            const next = new Map(prev);
            next.set(want.id, raster);
            return next;
          });
        }
      }
      if (!cancelled && runId.current === run) setWorking(null);
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on `signature`, the string form of `wanted` — listing the array
    // itself would re-run this on every render, and a re-run is an inference.
  }, [signature, source]);

  return { rasters, working, state };
}

function sameMaps(a: ReadonlyMap<string, BrushRaster>, b: ReadonlyMap<string, BrushRaster>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) if (a.get(k) !== v) return false;
  return true;
}

/**
 * Keep the last good raster for a layer still asking for one, and drop a layer
 * that no longer does — so a mask does not blink empty while the model thinks.
 */
function mergeKept(
  prev: ReadonlyMap<string, BrushRaster>,
  ready: ReadonlyMap<string, BrushRaster>,
  wanted: readonly { id: string }[],
): ReadonlyMap<string, BrushRaster> {
  const next = new Map(ready);
  const asking = new Set(wanted.map((w) => w.id));
  for (const [id, raster] of prev) if (asking.has(id) && !next.has(id)) next.set(id, raster);
  return next;
}
