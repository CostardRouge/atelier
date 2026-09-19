import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '../../shared/library/assets';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { refetchMedia, resolvableSource } from '../../shared/sources/winnow/resolve-media';
import { poolNameSet, refetchKey, refsToFetch } from './collage-refetch';
import {
  pickable,
  recoveryFromError,
  recoveryGone,
  type ElsewhereFetch,
  type SlideRecovery,
} from './use-slide-library';

/** How many pictures are asked of an instance at once. */
const PARALLEL = 3;

export interface CollageRefetch {
  /** What became of each picture still worth reporting, by `refetchKey`. */
  states: ReadonlyMap<string, SlideRecovery>;
  /** The report for one ref, or null. */
  recoveryOf: (ref: SavedMediaRef | null | undefined) => SlideRecovery | null;
  /** What `useSlideLibrary` needs to stand aside for a ref taken on here. */
  elsewhereFor: (ref: SavedMediaRef | null | undefined) => ElsewhereFetch;
}

/**
 * Fetch back EVERY drawn cell's picture a reload took out of the pool — not
 * only the selected one, which is all `useSlideLibrary` follows — so a
 * collage opens whole on the stage, in the rail and in the exports.
 *
 * The same rules as `useSlideLibrary`: only when the slide is opened (never
 * at boot), only for an instance this browser was given, and each picture at
 * most once per opening — a picture the author later takes out of the pool
 * is not fetched again behind their back. The files go into the pool and
 * nothing else: the active asset and the selected cell are left alone, so the
 * Library sync has nothing to re-point.
 *
 * `slideKey` is the slide's own key (not the per-cell shim); `refs` the drawn
 * cells' refs, lead first, or empty for a slide without a collage.
 */
export function useCollageRefetch(
  slideKey: string,
  refs: readonly (SavedMediaRef | null)[],
  assets: readonly Asset[],
  addFiles: (files: File[]) => void,
): CollageRefetch {
  const [states, setStates] = useState<ReadonlyMap<string, SlideRecovery>>(new Map());
  // Mirrors of the render state, written synchronously so a claim made in an
  // effect is visible to `useSlideLibrary` within the same commit.
  const statesRef = useRef(new Map<string, SlideRecovery>());
  const attempted = useRef(new Set<string>());
  const generation = useRef(0);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const addRef = useRef(addFiles);
  addRef.current = addFiles;

  const publish = useCallback((gen: number, key: string, next: SlideRecovery | null) => {
    if (gen !== generation.current) return;
    if (next) statesRef.current.set(key, next);
    else statesRef.current.delete(key);
    setStates(new Map(statesRef.current));
  }, []);

  // A new slide is a new opening: forget what was tried, drop what is late.
  useEffect(() => {
    generation.current++;
    attempted.current = new Set();
    statesRef.current = new Map();
    setStates(new Map());
    return () => {
      generation.current++;
    };
  }, [slideKey]);

  const signature = refs.map((r) => refetchKey(r) ?? '').join('|');
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    // Read through refs: the pool is looked at when a cell's picture changes,
    // never because the pool did.
    const pool = poolNameSet(assetsRef.current.map(pickable));
    const targets = refsToFetch(refsRef.current, pool, resolvableSource, attempted.current);
    if (!targets.length) return;
    const gen = generation.current;
    for (const t of targets) {
      attempted.current.add(t.key);
      statesRef.current.set(t.key, { state: 'fetching', sourceId: t.sourceId });
    }
    setStates(new Map(statesRef.current));

    const queue = [...targets];
    const worker = async () => {
      for (let t = queue.shift(); t && gen === generation.current; t = queue.shift()) {
        try {
          const files = await refetchMedia(t.ref);
          if (gen !== generation.current) return;
          if (files?.length) {
            addRef.current(files);
            publish(gen, t.key, null);
          } else {
            publish(gen, t.key, recoveryGone(t.ref, t.sourceId));
          }
        } catch (err) {
          publish(gen, t.key, recoveryFromError(err, t.sourceId));
        }
      }
    };
    for (let i = 0; i < Math.min(PARALLEL, targets.length); i++) void worker();
    // No cleanup: a cell changing mid-fetch must not strand the others, which
    // are already marked as tried. Only a new slide (the generation) drops them.
  }, [slideKey, signature, publish]);

  const stateOf = useCallback((ref: SavedMediaRef) => {
    const key = refetchKey(ref);
    return (key && statesRef.current.get(key)?.state) || null;
  }, []);
  const recoveryOf = useCallback(
    (ref: SavedMediaRef | null | undefined) => {
      const key = refetchKey(ref);
      return (key && states.get(key)) || null;
    },
    [states],
  );
  const elsewhereFor = useCallback(
    (ref: SavedMediaRef | null | undefined): ElsewhereFetch => ({
      stateOf,
      current: recoveryOf(ref)?.state ?? null,
    }),
    [stateOf, recoveryOf],
  );

  return useMemo(() => ({ states, recoveryOf, elsewhereFor }), [states, recoveryOf, elsewhereFor]);
}
