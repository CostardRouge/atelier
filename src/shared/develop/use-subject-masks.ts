import { useEffect, useRef, useState } from 'react';
import type { BrushRaster } from '../render/brush-raster';
import {
  composeSubject,
  prepareSegmentSource,
  segmentPoint,
  segmenterState,
  type SegmentSource,
  type SegmenterState,
} from '../segment/segmenter';
import { isConstrainedDevice } from '../lib/device-class';
import { subjectLayersToSegment, type AdjustLayer } from './layer';
import type { SubjectMask } from '../render/mask';
import type { SegmentView } from './segment-view';
import { knownSubjectPoints, type KnownPoints } from './subject-known';

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
 * - **Cached per POINT and per VIEW, not per request.** A layer's mask is the
 *   union of its points, so a third tap costs ONE inference rather than three,
 *   un-picking a point costs none, and two layers pointing at the same spot
 *   segment once. Nudging a slider never re-runs a four-second inference. The
 *   VIEW is the frame the model was shown (`SegmentView.key`): a lens
 *   correction or a keystone moves the subject in that frame, so a point is
 *   asked again there — and only there, never for a vignette or a colour.
 * - **The cache is the SESSION's, not the hook's.** The workbench is mounted
 *   per picture; a cache that died with it re-asked the model for every point
 *   on every landing. A picture come back to, unchanged, is instant.
 * - **The last good raster stays up while a new one is computed.** A mask that
 *   blinked empty for four seconds on every added point would read as broken.
 * - **The cache is BOUNDED.** A mask is about 0.75 MB at the model's input size;
 *   the newest `POINT_CACHE_SIZE` are kept (a quarter of that on a constrained
 *   device) and the oldest dropped, so a long session cannot fill the heap
 *   with subjects nobody is looking at.
 */
export interface SubjectMasks {
  /** Layer id → its alpha map. Absent while the first answer is still coming. */
  rasters: ReadonlyMap<string, BrushRaster>;
  /** A layer whose mask is being segmented right now, or null. */
  working: string | null;
  state: SegmenterState;
  /**
   * The region of the point the author has JUST tapped, once the model has
   * answered it — a new object per answer, so the host can blink it
   * (2026-09-23). Only a point tapped on this picture while it was open: a
   * picture re-opened, whose points are segmented again, blinks nothing.
   * `tone` says which way the tap went — a region ADDED, or one taken back
   * out (2026-10-02), which must not blink like an addition.
   */
  fresh: { layerId: string; raster: BrushRaster; tone: 'add' | 'remove' } | null;
}

/** How many points' masks are kept — ~50 MB at the model's input size, at most. */
export const POINT_CACHE_SIZE = 64;
/** The same on a phone (`device-memory.md`): ~12 MB. */
const POINT_CACHE_SIZE_CONSTRAINED = 16;

// View + point → its mask, for the session, bounded. Never cleared on a layer
// change: an undo that brings a subject back must not pay for it twice.
const pointCache = new Map<string, BrushRaster>();

function pointCacheSize(): number {
  return isConstrainedDevice() ? POINT_CACHE_SIZE_CONSTRAINED : POINT_CACHE_SIZE;
}

type Point = readonly [number, number];

function pointKey(pictureKey: string, model: string, [x, y]: Point): string {
  return `${pictureKey}|${model}|${x.toFixed(4)},${y.toFixed(4)}`;
}

/** One tap of a subject: the point, and whether it added or took away. */
interface SubjectTap {
  point: Point;
  tone: 'add' | 'remove';
}

/** Every tap of a subject, the added ones first — the order they compose in. */
function subjectTaps(mask: SubjectMask): SubjectTap[] {
  return [
    ...mask.points.map((point) => ({ point, tone: 'add' as const })),
    ...(mask.minus ?? []).map((point) => ({ point, tone: 'remove' as const })),
  ];
}

/**
 * A tap as the RECORD knows it: signed, because a point added and the same
 * point taken away are two different taps — while the model's answer to it,
 * cached under `pointKey`, is the same either way.
 */
function tapKey(pictureKey: string, model: string, tap: SubjectTap): string {
  return `${tap.tone === 'add' ? '+' : '-'}${pointKey(pictureKey, model, tap.point)}`;
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
  view,
  pictureKey,
}: {
  layers: readonly AdjustLayer[] | null | undefined;
  /** What the model is shown, and the name of its frame. Null while the picture is decoding. */
  view: SegmentView | null;
  /** Changes when the open picture does, so one picture's masks never serve another. */
  pictureKey: string;
}): SubjectMasks {
  const [rasters, setRasters] = useState<ReadonlyMap<string, BrushRaster>>(new Map());
  const [working, setWorking] = useState<string | null>(null);
  const [state, setState] = useState<SegmenterState>(segmenterState());
  const [fresh, setFresh] = useState<SubjectMasks['fresh']>(null);
  // Every subject layer's points as they stood at the last commit, for this
  // picture — what tells a TAPPED point from one merely segmented again.
  const known = useRef<{ picture: string; points: KnownPoints }>({
    picture: pictureKey,
    points: new Map(),
  });
  const source = view?.image ?? null;
  const viewKey = view?.key ?? '';
  // The source as the model is shown it, made once per source rather than
  // once per tap — a stage-budget picture resampled to 1024 per point was a
  // second of work before the model even started.
  const shown = useRef<{ source: TexImageSource; ready: Promise<SegmentSource> } | null>(null);
  const runId = useRef(0);

  // The requests, as a string, so the effect below runs when they really change
  // and not when a slider moves. Every visible subject with a point, drawing
  // or not (`subjectLayersToSegment`): the model runs on the tap, and the
  // raster is what "show the mask" paints before the layer has a develop.
  const wanted = subjectLayersToSegment(layers).map((l) => {
    const mask = l.mask as SubjectMask;
    return { id: l.id, model: mask.model, taps: subjectTaps(mask) };
  });
  const signature = wanted
    .map((w) => `${w.id}=${w.taps.map((t) => tapKey(pictureKey, w.model, t)).join(';')}`)
    .join('|');

  useEffect(() => {
    // A point is NEW when its layer was already known on this picture and the
    // point was not: the one the author just tapped. Read before the effect
    // below records the current points.
    const before = known.current.picture === pictureKey ? known.current.points : null;
    const isNew = (layerId: string, key: string) => Boolean(before?.get(layerId) && !before.get(layerId)?.has(key));
    if (!source) return;
    const run = ++runId.current;
    let cancelled = false;

    // Whatever is already cached goes up at once — including on a picture the
    // author has come back to, which is then instant. A layer whose EVERY point
    // is cached is composed here without an inference.
    const ready = new Map<string, BrushRaster>();
    const missing: typeof wanted = [];
    for (const want of wanted) {
      const plus: BrushRaster[] = [];
      const minus: BrushRaster[] = [];
      let complete = true;
      let tapped: SubjectMasks['fresh'] = null;
      for (const tap of want.taps) {
        const hit = lruGet(pointCache, `${viewKey}#${pointKey(pictureKey, want.model, tap.point)}`);
        if (!hit) {
          complete = false;
          break;
        }
        if (isNew(want.id, tapKey(pictureKey, want.model, tap))) tapped = { layerId: want.id, raster: hit, tone: tap.tone };
        (tap.tone === 'add' ? plus : minus).push(hit);
      }
      // A point tapped again where one was taken off: its answer is cached,
      // and it blinks all the same — it is still what the tap changed.
      if (complete && tapped) setFresh(tapped);
      const composed = complete ? composeSubject(plus, minus) : null;
      if (composed) ready.set(want.id, composed);
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
        const plus: (BrushRaster | null)[] = [];
        const minus: (BrushRaster | null)[] = [];
        for (const tap of want.taps) {
          if (cancelled || runId.current !== run) return;
          const key = `${viewKey}#${pointKey(pictureKey, want.model, tap.point)}`;
          let mask = lruGet(pointCache, key) ?? null;
          if (!mask) {
            mask = await segmentPoint(input.image, { x: tap.point[0], y: tap.point[1] });
            setState(segmenterState());
            if (mask) lruSet(pointCache, key, mask, pointCacheSize());
          }
          if (mask && isNew(want.id, tapKey(pictureKey, want.model, tap)) && !cancelled && runId.current === run) {
            setFresh({ layerId: want.id, raster: mask, tone: tap.tone });
          }
          (tap.tone === 'add' ? plus : minus).push(mask);
        }
        if (cancelled || runId.current !== run) return;
        const composed = composeSubject(plus, minus);
        if (composed) {
          const raster = composed;
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
  }, [signature, source, viewKey]);

  // Record every subject layer's points — those with none included, which is
  // what makes the FIRST tap on a fresh layer a new point — after the effect
  // above has read what stood before. Not a point a KNOWN layer gained while
  // the model has no view yet: that is the very first tap of all, and
  // recording it before the view arrived is what kept it from blinking. A
  // layer that arrives with its points — this picture just opened, the record
  // below starting empty for it — records them whole (`subject-known.ts`).
  const everySubject = (layers ?? [])
    .filter((l) => l.mask?.kind === 'subject')
    .map((l) => {
      const mask = l.mask as SubjectMask;
      // A point key holds `|` itself, so lines and tabs part the entries.
      return `${l.id}\t${subjectTaps(mask).map((t) => tapKey(pictureKey, mask.model, t)).join('\t')}`;
    })
    .join('\n');
  const viewReady = source !== null;
  useEffect(() => {
    const entries = (everySubject ? everySubject.split('\n') : []).map((entry) => {
      const [id, ...keys] = entry.split('\t');
      return { id, keys: keys.filter(Boolean) };
    });
    const previous = known.current.picture === pictureKey ? known.current.points : null;
    known.current = { picture: pictureKey, points: knownSubjectPoints(entries, previous, viewReady) };
    // Keyed on the string, for the reason the effect above is.
  }, [everySubject, pictureKey, viewReady]);

  // The shown copy goes with the hook.
  useEffect(
    () => () => {
      const held = shown.current;
      shown.current = null;
      void held?.ready.then((s) => s.release());
    },
    [],
  );

  return { rasters, working, state, fresh };
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
