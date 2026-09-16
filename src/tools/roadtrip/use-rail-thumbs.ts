import { useEffect, useMemo, useRef, useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader } from '../../shared/lut/frame-grader';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { badgeSettleSeconds } from '../../shared/roadtrip/badge-layout';
import {
  frameSize,
  loadBadgeSource,
  loadCollageSources,
  renderBadge,
  type BadgeSource,
} from '../../shared/roadtrip/badge-render';
import { collageMediaRefs } from '../../shared/roadtrip/collage';
import type { DeckSlide } from '../../shared/roadtrip/deck';
import type { HookPicture } from '../../shared/roadtrip/hooks/hook-variant';
import { slideRender } from '../../shared/roadtrip/slide-render';
import type { TripDoc, TripPost } from '../../shared/roadtrip/trip-types';

/**
 * Longest edge of a rail thumbnail, in device pixels. The cells are 44 CSS px
 * wide (56 tall in a row), so this is ~2× a dense screen's need — enough to
 * stay crisp, small enough that a whole deck's worth costs nothing.
 */
const THUMB_LONG_EDGE = 192;

/**
 * How wide a picture is decoded for a thumbnail. Generous against the frame
 * above, because a picture zoomed in shows only a fraction of itself: at the
 * maximum framing scale a 512 px decode still puts ~64 px across the cell.
 */
const SOURCE_WIDTH = 512;

/** Time to settle after an edit before re-drawing — a keystroke is not a job. */
const DEBOUNCE_MS = 350;

/**
 * A slide's identity in the rail. Content slides carry one; the hook and the
 * closing card are unique by kind.
 */
function slideKey(slide: DeckSlide): string {
  return slide.slideId ?? slide.kind;
}

/**
 * A stable number per LUT object, so a grade can go into a signature string.
 * The stack hands back the same object until the grade changes, which is what
 * makes reference identity the right key here.
 */
const lutIds = new WeakMap<CubeLut, number>();
let nextLutId = 0;
function lutId(lut: CubeLut | null): number {
  if (!lut) return 0;
  const known = lutIds.get(lut);
  if (known !== undefined) return known;
  nextLutId += 1;
  lutIds.set(lut, nextLutId);
  return nextLutId;
}

/**
 * The same trick for the opener's picture set, which cannot be stringified:
 * `use-hook-pictures` hands back a NEW map only when a picture has actually
 * landed, changed or gone, so its identity IS "the pictures changed". Without
 * it a hook cell would keep the map-with-no-photographs it was first drawn
 * with — the signature it is compared against is JSON, and a decoded bitmap
 * has no JSON.
 */
const pictureIds = new WeakMap<object, number>();
let nextPictureId = 0;
function picturesId(pictures: ReadonlyMap<string, HookPicture> | undefined): number {
  if (!pictures) return 0;
  const known = pictureIds.get(pictures);
  if (known !== undefined) return known;
  nextPictureId += 1;
  pictureIds.set(pictures, nextPictureId);
  return nextPictureId;
}

interface RailThumbInputs {
  trip: TripDoc;
  post: TripPost;
  slides: readonly DeckSlide[];
  aspect: number;
  /** Finds a slide's picture in the Library, or null when it is not loaded. */
  resolve: (ref: SavedMediaRef | null) => File | null;
  /**
   * The cube a slide is rendered through — its own grade baked with its own
   * develop (`TripGradeBinding.lutFor`); null leaves its picture as shot. A
   * new function whenever the stack changes, which is what re-signs every
   * cell; the cube's identity is what `lutId` signs each one with, so a slide
   * that departed re-draws on its own and not on the deck's.
   */
  lutFor: (slide: DeckSlide) => CubeLut | null;
  /**
   * The opener's decoded pictures — an itinerary pins them at rest, which is
   * exactly when a thumbnail is drawn, so a cell without them would show a
   * map the deck does not deliver.
   */
  pictures?: ReadonlyMap<string, HookPicture>;
  /** The hook picture's exposure line, when the piece credits its camera. */
  exposure?: string | null;
}

/** One slide's thumbnail, or null while it has never been drawn. */
export type RailThumbs = (slide: DeckSlide) => string | null;

/**
 * A picture of every slide as it will really be delivered — the crop, the
 * caption, the badge, the grade — for the rail beside the stage.
 *
 * The cells used to draw the raw file with `object-cover`, which is a
 * DIFFERENT picture from the one the piece exports the moment a slide is
 * zoomed, straightened or captioned; the maintainer read that (rightly) as
 * the rail not updating. They now go through `renderBadge`, the one renderer
 * the stage and the PNG deck use, at cell size.
 *
 * What keeps that affordable:
 *
 * - Each slide carries a SIGNATURE of everything drawn into it. A pass
 *   redraws only the cells whose signature moved, so editing the hook costs
 *   the hook, and switching slides costs nothing at all.
 * - Pictures are decoded at `SOURCE_WIDTH`, not at their own density: a
 *   carousel of 48-megapixel stills would otherwise put 194 MB up per cell.
 * - One decoded source is kept between passes, so a run of keystrokes on the
 *   same slide decodes once rather than once per settle.
 * - Slides are drawn one at a time, and a pass is abandoned the moment its
 *   inputs change.
 */
export default function useRailThumbs({
  trip,
  post,
  slides,
  aspect,
  resolve,
  lutFor,
  pictures,
  exposure,
}: RailThumbInputs): RailThumbs {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  /** What has been drawn, and from what. A null url is a failed decode. */
  const drawn = useRef(new Map<string, { sig: string; url: string | null }>());
  /** The one source kept alive between passes, and what it was loaded from. */
  const held = useRef<{ key: string; source: BadgeSource } | null>(null);
  /** False once unmounted, so a decode that lands after it is not held on to. */
  const mounted = useRef(true);

  // The badge is drawn settled, whatever the transport is doing: a thumbnail
  // caught mid-entrance is a thumbnail that changes while you watch it.
  const settle = badgeSettleSeconds(post.badge.pieceStyles, post.badge.cascade);

  const jobs = useMemo(
    () =>
      slides.map((slide) => {
        const file = slide.kind === 'cta' ? null : resolve(slide.media);
        const render = slideRender(trip, post, slide, aspect, pictures, exposure);
        // The cube of THIS slide: the grade it wears, baked with its own
        // develop. The bake is memoised per (grade, develop), so a deck of
        // untouched slides reads one cube and only a slide that departed —
        // in its correction or in its look — pays for one of its own.
        const lut = slide.kind === 'cta' ? null : lutFor(slide);
        // A collage cell is signed by ITS file and ITS cube, so a picture
        // landing in cell four redraws this slide and no other.
        const collageFiles = slide.collage
          ? collageMediaRefs(slide, slide.collage).map((ref) => {
              const f = resolve(ref);
              return f ? [f.name, f.size, f.lastModified] : null;
            })
          : null;
        const collageLuts = slide.collage
          ? [slide, ...slide.collage.cells].map((cell) => lutId(lutFor({ ...slide, develop: cell.develop })))
          : null;
        return {
          key: slideKey(slide),
          slide,
          file,
          render,
          lut,
          sig: JSON.stringify([
            render,
            aspect,
            lutId(lut),
            slide.videoTimeSeconds,
            file ? [file.name, file.size, file.lastModified] : null,
            slide.collage,
            collageFiles,
            collageLuts,
            // Only the hook's cell reads them; signing every cell with them
            // would redraw a whole carousel each time one picture lands.
            slide.kind === 'hook' ? picturesId(pictures) : 0,
          ]),
        };
      }),
    [slides, trip, post, aspect, resolve, lutFor, pictures, exposure],
  );

  useEffect(() => {
    let cancelled = false;

    /** The decoded picture behind a job, reusing the held one when it fits. */
    async function sourceFor(job: (typeof jobs)[number]): Promise<BadgeSource | null> {
      if (!job.file) return null;
      const key = `${job.file.name}|${job.file.size}|${job.file.lastModified}`;
      const have = held.current;
      if (have?.key === key) {
        // Same clip, another moment: seek the element that is already open
        // rather than building a second decoder for it.
        if (have.source.seek) await have.source.seek(job.slide.videoTimeSeconds);
        return have.source;
      }
      have?.source.release();
      held.current = null;
      const source = await loadBadgeSource(job.file, job.slide.videoTimeSeconds, SOURCE_WIDTH);
      if (!mounted.current) {
        source.release();
        return null;
      }
      held.current = { key, source };
      return source;
    }

    async function draw(job: (typeof jobs)[number]): Promise<string | null> {
      const canvas = document.createElement('canvas');
      const { w, h } = frameSize(aspect, THUMB_LONG_EDGE);
      canvas.width = w;
      canvas.height = h;
      // A collage decodes every cell at thumbnail width for this one draw;
      // the held source is for the common case of one picture per slide.
      const cells = job.slide.collage
        ? await loadCollageSources(job.slide, job.slide.collage, resolve, SOURCE_WIDTH)
        : null;
      const source = cells ? null : await sourceFor(job);
      // A grader is a WebGL2 context: made for this one draw and disposed
      // straight after, exactly as `badgeToPng` does per slide.
      const grader =
        job.lut && source && source.width > 0
          ? makeFrameGrader(job.lut, source.width, source.height)
          : null;
      const cellGraders = (cells?.items ?? []).map((item) => {
        const lut = lutFor({ ...job.slide, develop: item.develop });
        return lut && item.source && item.source.width > 0
          ? makeFrameGrader(lut, item.source.width, item.source.height)
          : null;
      });
      try {
        await renderBadge(canvas, {
          ...job.render,
          source,
          grader,
          collage:
            cells && job.slide.collage
              ? {
                  collage: job.slide.collage,
                  items: cells.items.map((item, i) => ({ ...item, grader: cellGraders[i] })),
                }
              : null,
          // Past the opener too: a scrub's thumbnail mid-sweep would be
          // another day's picture standing for this one.
          timeSeconds:
            job.slide.kind === 'hook' ? Math.max(settle, job.render.hook?.seconds ?? 0) : 0,
        });
      } finally {
        grader?.dispose();
        for (const g of cellGraders) g?.dispose();
        cells?.release();
      }
      return new Promise((resolve_) =>
        canvas.toBlob(
          (blob) => resolve_(blob ? URL.createObjectURL(blob) : null),
          'image/jpeg',
          0.82,
        ),
      );
    }

    async function run() {
      // Forget the cells this deck no longer has, or a deleted slide's
      // picture is held for the lifetime of the document.
      const alive = new Set(jobs.map((job) => job.key));
      for (const [key, entry] of drawn.current) {
        if (alive.has(key)) continue;
        if (entry.url) URL.revokeObjectURL(entry.url);
        drawn.current.delete(key);
      }

      for (const job of jobs) {
        if (cancelled) return;
        if (drawn.current.get(job.key)?.sig === job.sig) continue;
        let url: string | null = null;
        try {
          url = await draw(job);
        } catch {
          // An undecodable file costs its cell its picture, never the rail.
          // The signature is stored all the same, so it is not retried on
          // every pass.
        }
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        const stale = drawn.current.get(job.key);
        drawn.current.set(job.key, { sig: job.sig, url });
        if (stale?.url) URL.revokeObjectURL(stale.url);
        setUrls(
          new Map(
            [...drawn.current].flatMap(([key, entry]) =>
              entry.url ? [[key, entry.url] as [string, string]] : [],
            ),
          ),
        );
      }
    }

    const timer = window.setTimeout(() => void run(), DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobs, aspect, settle, resolve, lutFor]);

  // The blobs and the decoded picture are the only heavy things this holds.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const entry of drawn.current.values()) {
        if (entry.url) URL.revokeObjectURL(entry.url);
      }
      drawn.current.clear();
      held.current?.source.release();
      held.current = null;
    };
  }, []);

  return (slide: DeckSlide) => urls.get(slideKey(slide)) ?? null;
}
