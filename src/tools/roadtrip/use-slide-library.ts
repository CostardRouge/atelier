import { useEffect, useRef, useState } from 'react';
import type { Asset } from '../../shared/library/assets';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { findMedia, hashedMediaRef } from '../../shared/projects/media-identity';
import type { DeckSlide } from '../../shared/roadtrip/deck';
import { WinnowError } from '../../shared/sources/winnow/client';
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
 * It is still one request per slide, made only when that slide is opened —
 * never at boot, never for an instance this browser has not been given.
 */
export function useSlideLibrary(
  slide: DeckSlide,
  assets: readonly Asset[],
  setActive: (id: string) => void,
  activeFile: File | null,
  setSlideMedia: (ref: SavedMediaRef | null) => void,
  addFiles?: (files: File[]) => void,
): SlideRecovery | null {
  const isCta = slide.kind === 'cta';
  const restoredFor = useRef<string | null>(null);
  const slideKey = slide.slideId ?? slide.kind;
  const [recovery, setRecovery] = useState<SlideRecovery | null>(null);
  // Read inside the effect without making it a dependency: `addFiles` is a
  // fresh callback on some renders, and re-running the restore would re-fetch.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  useEffect(() => {
    if (restoredFor.current === slideKey) return;
    if (isCta || !slide.media) {
      restoredFor.current = slideKey;
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
        restoredFor.current = slideKey;
        return;
      }
      const sourceId = resolvableSource(want);
      const add = addFilesRef.current;
      if (!sourceId || !add) {
        setRecovery(null);
        restoredFor.current = slideKey;
        return;
      }
      // Claim the slide before the await: a second pass while the bytes are
      // in flight would fetch them twice.
      restoredFor.current = slideKey;
      setRecovery({ state: 'fetching', sourceId });
      try {
        const files = await refetchMedia(want);
        if (cancelled) return;
        if (files?.length) {
          add(files);
          // The Library rebuilds from the new files; the effect below picks
          // the slide's picture up as the active one on the next pass.
          restoredFor.current = null;
          setRecovery(null);
        } else {
          setRecovery({
            state: 'failed',
            sourceId,
            problem: `${sourceId} no longer has “${want.name}”.`,
          });
        }
      } catch (err) {
        if (cancelled) return;
        const unauthenticated = err instanceof WinnowError && err.kind === 'unauthenticated';
        setRecovery({
          state: 'failed',
          sourceId,
          problem: unauthenticated
            ? `Not signed in to ${sourceId}.`
            : err instanceof Error
              ? err.message
              : String(err),
          ...(unauthenticated ? { loginUrl: `https://${sourceId}/login` } : {}),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [slideKey, slide.media, isCta, assets, setActive]);

  useEffect(() => {
    if (restoredFor.current !== slideKey || !activeFile || isCta) return;
    if (slide.media?.name.toLowerCase() === activeFile.name.toLowerCase()) return;
    let cancelled = false;
    void hashedMediaRef(activeFile).then((ref) => {
      if (!cancelled) setSlideMedia(ref);
    });
    return () => {
      cancelled = true;
    };
  }, [activeFile, slideKey, slide.media, isCta, setSlideMedia]);

  return recovery;
}
