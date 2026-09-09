import { useEffect, useMemo, useRef, useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader } from '../../shared/lut/frame-grader';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { badgeSettleSeconds } from '../../shared/roadtrip/badge-layout';
import {
  frameSize,
  loadBadgeSource,
  renderBadge,
  type BadgeSource,
} from '../../shared/roadtrip/badge-render';
import type { DeckSlide } from '../../shared/roadtrip/deck';
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

interface RailThumbInputs {
  trip: TripDoc;
  post: TripPost;
  slides: readonly DeckSlide[];
  aspect: number;
  /** Finds a slide's picture in the Library, or null when it is not loaded. */
  resolve: (ref: SavedMediaRef | null) => File | null;
  /** The composed grade every picture goes through; null leaves them as shot. */
  lut: CubeLut | null;
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
  lut,
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
  const settle = badgeSettleSeconds(post.badge.pieceStyles);

  const jobs = useMemo(
    () =>
      slides.map((slide) => {
        const file = slide.kind === 'cta' ? null : resolve(slide.media);
        const render = slideRender(trip, post, slide, aspect);
        return {
          key: slideKey(slide),
          slide,
          file,
          render,
          sig: JSON.stringify([
            render,
            aspect,
            lutId(lut),
            slide.videoTimeSeconds,
            file ? [file.name, file.size, file.lastModified] : null,
          ]),
        };
      }),
    [slides, trip, post, aspect, resolve, lut],
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
      const source = await sourceFor(job);
      // A grader is a WebGL2 context: made for this one draw and disposed
      // straight after, exactly as `badgeToPng` does per slide.
      const grader =
        lut && source && source.width > 0
          ? makeFrameGrader(lut, source.width, source.height)
          : null;
      try {
        await renderBadge(canvas, {
          ...job.render,
          source,
          grader,
          timeSeconds: job.slide.kind === 'hook' ? settle : 0,
        });
      } finally {
        grader?.dispose();
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
  }, [jobs, aspect, lut, settle]);

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
