import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset } from '../../shared/library/assets';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { findMedia, hashedMediaRef } from '../../shared/projects/media-identity';
import type { DeckSlide } from '../../shared/roadtrip/deck';
import { WinnowError } from '../../shared/sources/winnow/client';
import { restoreClaim, syncMove } from './library-sync';
import {
  isResolvable,
  refetchMedia,
  resolvableSource,
} from '../../shared/sources/winnow/resolve-media';

/** The file a Library asset composes over: its image, else its video. */
export function pickable(asset: Asset): File | null {
  return asset.parts.image ?? asset.parts.video ?? null;
}

/**
 * What became of a slide's picture when the Library did not hold it: it is
 * being fetched from the instance that has it, or the instance had something
 * to say. Null while there is nothing to report.
 */
export interface SlideRecovery {
  state: 'fetching' | 'failed';
  /** The instance the picture lives on. */
  sourceId: string;
  /** One line a person can act on — only when it failed. */
  problem?: string;
  /** Where to sign in, when that is what went wrong. */
  loginUrl?: string;
}

/** What another fetcher is doing with a picture — see `useSlideLibrary`. */
export interface ElsewhereFetch {
  stateOf: (ref: SavedMediaRef) => SlideRecovery['state'] | null;
  current: SlideRecovery['state'] | null;
}

/** What a failed fetch from `sourceId` tells the author. */
export function recoveryFromError(err: unknown, sourceId: string): SlideRecovery {
  const unauthenticated = err instanceof WinnowError && err.kind === 'unauthenticated';
  return {
    state: 'failed',
    sourceId,
    problem: unauthenticated
      ? `Not signed in to ${sourceId}.`
      : err instanceof Error
        ? err.message
        : String(err),
    ...(unauthenticated ? { loginUrl: `https://${sourceId}/login` } : {}),
  };
}

/** What an instance that answered "no such asset" tells the author. */
export function recoveryGone(ref: SavedMediaRef, sourceId: string): SlideRecovery {
  return { state: 'failed', sourceId, problem: `${sourceId} no longer has “${ref.name}”.` };
}

/**
 * Keep the Library and the open slide pointed at the same picture, both
 * ways: opening a slide activates its picture, and from then on picking
 * another asset in the sidebar re-points the slide.
 *
 * The trap this guards: the restore must run only once per slide and only
 * after the Library has loaded, and the record-back must be gated on the
 * restore having run — otherwise the first render writes whatever happened to
 * be active over the slide's own choice. Keyed by slide, so stepping through
 * a carousel re-points the Library each time rather than writing the first
 * slide's picture over the others.
 *
 * When the Library has nothing and the slide's ref names a CONNECTED Winnow,
 * the picture is fetched back rather than reported missing: a reload empties
 * the pool, and re-picking the day on the calendar was the whole friction.
 * It is still one request per picture, made only when that slide is opened —
 * never at boot, never for an instance this browser has not been given.
 *
 * Which of the two moves is `library-sync.ts`, and the rule it states is what
 * makes UNDO work here: the slide takes the tick only when the AUTHOR moved
 * the tick; a picture that changed under it (an undo, a cleared cell) re-points
 * the Library instead of being written back.
 */
export function useSlideLibrary(
  slide: DeckSlide,
  assets: readonly Asset[],
  setActive: (id: string) => void,
  activeFile: File | null,
  setSlideMedia: (ref: SavedMediaRef | null) => void,
  addFiles?: (files: File[]) => void,
  /**
   * Another fetcher that may already have taken this slide's picture on (a
   * collage fetching all its cells, `use-collage-refetch.ts`). While it is
   * `fetching`, the restore waits for the pool to change instead of asking a
   * second time; once it has `failed`, the restore stands down and leaves the
   * reporting to it. `stateOf` is read synchronously, so a claim made in the
   * same commit is seen; `current` is this slide's state as rendered, so a
   * failure re-runs the restore.
   */
  fetchedElsewhere?: ElsewhereFetch,
): SlideRecovery | null {
  const isCta = slide.kind === 'cta';
  const restoredFor = useRef<string | null>(null);
  const slideKey = slide.slideId ?? slide.kind;
  /** The slide AND the picture it names: a picture that changes is restored again. */
  const claim = restoreClaim(slideKey, slide.media);
  /**
   * The tick as the record-back last acted on it. Seeded with what is ticked on
   * the first render, so opening a piece over another picture is not a pick.
   */
  const seenActive = useRef<File | null>(activeFile);
  const [recovery, setRecovery] = useState<SlideRecovery | null>(null);
  // The claim is a ref (it must be taken synchronously, before an await, or a
  // second pass fetches the same bytes twice) and the counter is its render
  // mirror, so the record-back below is woken by a restore that settles — the
  // same pattern as `use-collage-refetch.ts`.
  const [settled, setSettled] = useState(0);
  const settle = useCallback((key: string | null) => {
    restoredFor.current = key;
    setSettled((n) => n + 1);
  }, []);
  // Read inside the effect without making it a dependency: `addFiles` is a
  // fresh callback on some renders, and re-running the restore would re-fetch.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  const elsewhereRef = useRef(fetchedElsewhere?.stateOf);
  elsewhereRef.current = fetchedElsewhere?.stateOf;
  const elsewhereNow = fetchedElsewhere?.current ?? null;

  useEffect(() => {
    if (restoredFor.current === claim) return;
    if (isCta || !slide.media) {
      settle(claim);
      setRecovery(null);
      return;
    }
    if (!assets.length && !isResolvable(slide.media)) return;
    // Name first, then the content hash: an export that came back renamed or
    // re-graded is the same picture, and the slide should still find it.
    const want = slide.media;
    const byAsset = new Map<File, string>();
    for (const asset of assets) {
      const f = pickable(asset);
      if (f) byAsset.set(f, asset.id);
    }
    let cancelled = false;
    void findMedia(want, [...byAsset.keys()]).then(async (file) => {
      if (cancelled) return;
      const id = file ? byAsset.get(file) : undefined;
      if (id) {
        setActive(id);
        setRecovery(null);
        settle(claim);
        return;
      }
      const elsewhere = elsewhereRef.current?.(want) ?? null;
      if (elsewhere) {
        // While fetching: not claimed — the pool changing when those bytes
        // land re-runs this, and the picture is activated then. Once failed:
        // claimed, so ticking another picture still re-points the slide.
        if (elsewhere === 'failed') settle(claim);
        setRecovery(null);
        return;
      }
      const sourceId = resolvableSource(want);
      const add = addFilesRef.current;
      if (!sourceId || !add) {
        setRecovery(null);
        settle(claim);
        return;
      }
      // Claim the picture before the await: a second pass while the bytes are
      // in flight would fetch them twice.
      settle(claim);
      setRecovery({ state: 'fetching', sourceId });
      try {
        const files = await refetchMedia(want);
        if (cancelled) return;
        if (files?.length) {
          add(files);
          // The Library rebuilds from the new files; the effect below picks
          // the slide's picture up as the active one on the next pass.
          settle(null);
          setRecovery(null);
        } else {
          setRecovery(recoveryGone(want, sourceId));
        }
      } catch (err) {
        if (cancelled) return;
        setRecovery(recoveryFromError(err, sourceId));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [claim, slide.media, isCta, assets, setActive, elsewhereNow, settle]);

  useEffect(() => {
    if (isCta) return;
    const move = syncMove({
      settled: restoredFor.current === claim,
      // The tick MOVED — the author picked a picture. Anything else that puts
      // the two out of step is the document moving, and the restore above is
      // what answers it.
      tickMoved: seenActive.current !== activeFile,
      slideName: slide.media?.name ?? null,
      activeName: activeFile?.name ?? null,
    });
    // A pass that stood down because the restore is still in flight has not
    // acted on the tick, so what it saw is not what the next pass compares
    // against: the pick made while a picture was being fetched back is still
    // a pick once that fetch lands.
    if (move !== 'restore') seenActive.current = activeFile;
    if (move !== 'record' || !activeFile) return;
    let cancelled = false;
    void hashedMediaRef(activeFile).then((ref) => {
      if (!cancelled) setSlideMedia(ref);
    });
    return () => {
      cancelled = true;
    };
  }, [activeFile, claim, settled, slide.media, isCta, setSlideMedia]);

  return recovery;
}
