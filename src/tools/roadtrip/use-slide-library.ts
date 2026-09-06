import { useEffect, useRef } from 'react';
import type { Asset } from '../../shared/library/assets';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { findMedia, hashedMediaRef } from '../../shared/projects/media-identity';
import type { DeckSlide } from '../../shared/roadtrip/deck';

/** The file a Library asset composes over: its image, else its video. */
export function pickable(asset: Asset): File | null {
  return asset.parts.image ?? asset.parts.video ?? null;
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
 */
export function useSlideLibrary(
  slide: DeckSlide,
  assets: readonly Asset[],
  setActive: (id: string) => void,
  activeFile: File | null,
  setSlideMedia: (ref: SavedMediaRef | null) => void,
): void {
  const isCta = slide.kind === 'cta';
  const restoredFor = useRef<string | null>(null);
  const slideKey = slide.slideId ?? slide.kind;

  useEffect(() => {
    if (restoredFor.current === slideKey) return;
    if (isCta || !slide.media) {
      restoredFor.current = slideKey;
      return;
    }
    if (!assets.length) return;
    // Name first, then the content hash: an export that came back renamed or
    // re-graded is the same picture, and the slide should still find it.
    const want = slide.media;
    const byAsset = new Map<File, string>();
    for (const asset of assets) {
      const f = pickable(asset);
      if (f) byAsset.set(f, asset.id);
    }
    let cancelled = false;
    void findMedia(want, [...byAsset.keys()]).then((file) => {
      if (cancelled) return;
      const id = file ? byAsset.get(file) : undefined;
      if (id) setActive(id);
      restoredFor.current = slideKey;
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
}
