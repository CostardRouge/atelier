import { useEffect, useRef, useState } from 'react';
import type { BrushRaster } from '../render/brush-raster';
import {
  prepareSegmentSource,
  segmentPoint,
  segmenterState,
  unionMasks,
  type SegmentSource,
  type SegmenterState,
} from '../segment/segmenter';
import { subjectRequests, type AdjustLayer } from './layer';

/**
 * The alpha map for every SUBJECT layer on the open picture, resolved by the
 * model and kept for the session.
 *
 * The raster is DERIVED data, never the document's (`render-layers.md`): what
 * is stored is the points and the model id, and this turns that request into
 * pixels. Which is why it is a hook and not a field — it is a cache with a
 * lifetime, not a value.
 *
 * Four rules it exists to hold:
 *
 * - **One inference at a time, across every layer.** The task has a single
 *   result slot; two in flight can have their answers swapped.
 * - **Cached per POINT, not per request.** A layer's mask is the union of its
 *   points, so a third tap costs ONE inference rather than three, un-picking a
 *   point costs none, and two layers pointing at the same spot segment once.
 *   Nudging a slider never re-runs a four-second inference.
 * - **The last good raster stays up while a new one is computed.** A mask that
 *   blinked empty for four seconds on every added point would read as broken.
 * - **The cache is BOUNDED.** A mask is about 0.75 MB at the model's input size;
 *   the newest `POINT_CACHE_SIZE` are kept and the oldest dropped, so a long
 *   session cannot fill the heap with subjects nobody is looking at.
 */
export interface SubjectMasks {
  /** Layer id → its alpha map. Absent while the first answer is still coming. */
  rasters: ReadonlyMap<string, BrushRaster>;
  /** A layer whose mask is being segmented right now, or null. */
  working: string | null;
  state: SegmenterState;
}

/** How many points' masks are kept — ~50 MB at the model's input size, at most. */
export const POINT_CACHE_SIZE = 64;

type Point = readonly [number, number];

function pointKey(pictureKey: string, model: string, [x, y]: Point): string {
  return `${pictureKey}|${model}|${x.toFixed(4)},${y.toFixed(4)}`;
}

/** A Map used as an LRU: a hit is re-inserted at the end, an insert past the cap evicts the oldest. */
function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function lruSet<V>(cache: Map<string, V>, key: string, value: V, cap: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > cap) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
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
  // Point key → its mask, for the session, bounded. Never cleared on a layer
  // change: an undo that brings a subject back must not pay for it twice.
  const cache = useRef(new Map<string, BrushRaster>());
  // The source as the model is shown it, made once per source rather than
  // once per tap — a stage-budget picture resampled to 1024 per point was a
  // second of work before the model even started.
  const shown = useRef<{ source: TexImageSource; ready: Promise<SegmentSource> } | null>(null);
  const runId = useRef(0);

  // The requests, as a string, so the effect below runs when they really change
  // and not when a slider moves.
  const wanted = subjectRequests(layers);
  const signature = wanted
    .map((w) => `${w.id}=${w.points.map((p) => pointKey(pictureKey, w.model, p)).join(';')}`)
    .join('|');

  useEffect(() => {
    if (!source) return;
    const run = ++runId.current;
    let cancelled = false;

    // Whatever is already cached goes up at once — including on a picture the
    // author has come back to, which is then instant. A layer whose EVERY point
    // is cached is composed here without an inference.
    const ready = new Map<string, BrushRaster>();
    const missing: typeof wanted = [];
    for (const want of wanted) {
      let union: BrushRaster | null = null;
      let complete = true;
      for (const point of want.points) {
        const hit = lruGet(cache.current, pointKey(pictureKey, want.model, point));
        if (!hit) {
          complete = false;
          break;
        }
        union = unionMasks(union, hit);
      }
      if (complete && union) ready.set(want.id, union);
      else missing.push(want);
    }
    if (ready.size) setRasters((prev) => (sameMaps(prev, ready) ? prev : mergeKept(prev, ready, wanted)));
    if (missing.length === 0) {
      setWorking(null);
      return;
    }

    if (!shown.current || shown.current.source !== source) {
      const previous = shown.current;
      shown.current = { source, ready: prepareSegmentSource(source) };
      void previous?.ready.then((s) => s.release());
    }
    const shownNow = shown.current;

    void (async () => {
      const input = await shownNow.ready;
      for (const want of missing) {
        if (cancelled || runId.current !== run) return;
        setWorking(want.id);
        let union: BrushRaster | null = null;
        for (const point of want.points) {
          if (cancelled || runId.current !== run) return;
          const key = pointKey(pictureKey, want.model, point);
          let mask = lruGet(cache.current, key) ?? null;
          if (!mask) {
            mask = await segmentPoint(input.image, { x: point[0], y: point[1] });
            setState(segmenterState());
            if (mask) lruSet(cache.current, key, mask, POINT_CACHE_SIZE);
          }
          union = unionMasks(union, mask);
        }
        if (cancelled || runId.current !== run) return;
        if (union) {
          const raster = union;
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

  // The shown copy goes with the hook.
  useEffect(
    () => () => {
      const held = shown.current;
      shown.current = null;
      void held?.ready.then((s) => s.release());
    },
    [],
  );

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
