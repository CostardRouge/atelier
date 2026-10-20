import { useCallback, useMemo, useRef } from 'react';
import { fileBaseName } from '../../shared/library/assets';
import { hashedMediaRefs } from '../../shared/projects/media-identity';
import type { DeckSlide } from '../../shared/roadtrip/deck';
import { collageMediaRefs } from '../../shared/roadtrip/collage';
import { insertSlides, MAX_COLLAGE_PICTURES } from '../../shared/roadtrip/insert-slides';
import type { TripPost } from '../../shared/roadtrip/trip-types';
import type { IntakeItem, IntakeOptions, MediaIntake } from '../../shared/sources/media-scope';

const base = (name: string) => fileBaseName(name).toLowerCase();

/** The pictures a deck slide draws — its own and, on a collage, every cell's. */
function slideBases(slide: DeckSlide): string[] {
  if (slide.kind === 'cta') return [];
  const refs = slide.collage ? collageMediaRefs(slide, slide.collage) : slide.media ? [slide.media] : [];
  return refs.map((r) => base(r.name));
}

export interface SlideIntakeInput {
  post: TripPost;
  onChangePost: (post: TripPost) => void;
  /** The deck as the band draws it — what a slide's NUMBER is counted in. */
  slides: readonly DeckSlide[];
  /** The open slide, what "after the open one" lands behind. */
  open: DeckSlide | null;
  /** The piece's frame, width ÷ height — a two-picture collage splits along it. */
  aspect: number;
  /** Why the deck's order may not change now (an export runs), or null. */
  locked: string | null;
  /** Called with the first new slide's id once it is written, to open it. */
  onLanded: (slideId: string) => void;
  /** A slide's rail thumbnail, as the band draws it. */
  thumbFor: (slide: DeckSlide) => string | null;
}

/**
 * The open piece, offered to the Library as somewhere pictures GO
 * (`MediaIntake`): the ＋ on a tile, the lightbox's «Add as slide N», a
 * ticked batch, all land here as new slides — never on the slide that is
 * open, which is what a plain tap on a tile still does.
 *
 * One write per add, so ⌘Z takes back exactly what one gesture made. The
 * write goes through the LATEST piece: a picture fetched from an instance
 * lands seconds after it was asked for, and the piece may have moved since.
 * What was added through here this session can be taken back from the tile
 * that added it (the ＋ turned into the slide's number); a slide the author
 * has since given a collage keeps its picture.
 */
export function useSlideIntake({
  post,
  onChangePost,
  slides,
  open,
  aspect,
  locked,
  onLanded,
  thumbFor,
}: SlideIntakeInput): MediaIntake {
  const postRef = useRef(post);
  postRef.current = post;
  const writeRef = useRef(onChangePost);
  writeRef.current = onChangePost;
  const landRef = useRef(onLanded);
  landRef.current = onLanded;
  /** Slides this session added through the intake — the only ones a tile may take back. */
  const added = useRef(new Set<string>());

  const places = useMemo(() => {
    const map = new Map<string, number>();
    for (const slide of slides) {
      for (const b of slideBases(slide)) if (!map.has(b)) map.set(b, slide.position);
    }
    return map;
  }, [slides]);

  /** The slide this session added that holds this picture alone, or null. */
  const addedHolding = useCallback((name: string) => {
    const b = name.toLowerCase();
    return (
      postRef.current.slides.find(
        (s) => added.current.has(s.id) && !s.collage && s.media && base(s.media.name) === b,
      ) ?? null
    );
  }, []);

  const add = useCallback(
    async (files: readonly File[], options: IntakeOptions = {}) => {
      if (!files.length) return;
      const refs = await hashedMediaRefs(files);
      const { post: next, ids } = insertSlides(postRef.current, refs, {
        after: options.afterOpen ? (open?.slideId ?? null) : null,
        together: options.together,
        aspect,
      });
      if (!ids.length) return;
      for (const id of ids) added.current.add(id);
      writeRef.current(next);
      landRef.current(ids[0]);
    },
    [open?.slideId, aspect],
  );

  const remove = useCallback(
    (name: string) => {
      const slide = addedHolding(name);
      if (!slide) return;
      added.current.delete(slide.id);
      writeRef.current({ ...postRef.current, slides: postRef.current.slides.filter((s) => s.id !== slide.id) });
    },
    [addedHolding],
  );

  const pictures = slides.filter((s) => s.kind !== 'cta').length;
  const items = useMemo<IntakeItem[]>(
    () =>
      slides.map((s) => ({
        key: s.slideId,
        number: s.kind === 'cta' ? null : s.position,
        thumb: thumbFor(s),
        open: s.slideId === open?.slideId,
        fresh: added.current.has(s.slideId),
      })),
    [slides, thumbFor, open?.slideId],
  );
  return useMemo<MediaIntake>(
    () => ({
      publisher: 'Trips',
      noun: 'slide',
      placeOf: (name) => places.get(name.toLowerCase()) ?? null,
      // Before the closing card: the next number is the pictures' count plus one.
      next: pictures + 1,
      removable: (name) => addedHolding(name) !== null,
      add,
      remove,
      locked,
      together: { word: 'collage', max: MAX_COLLAGE_PICTURES },
      afterOpen: open && open.kind !== 'cta' ? `After slide ${open.position}` : null,
      title: 'This piece',
      items,
    }),
    [places, pictures, addedHolding, add, remove, locked, open, items],
  );
}
