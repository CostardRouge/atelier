import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '../../shared/library/assets';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader, type FrameGrader } from '../../shared/lut/frame-grader';
import { findMedia } from '../../shared/projects/media-identity';
import type {
  HookContext,
  HookLayer,
  HookPicture,
  HookPictureStatus,
  HookPictureWant,
} from '../../shared/roadtrip/hooks/hook-variant';
import { coverCrop, perPicturePixels, wholeCrop } from '../../shared/roadtrip/hooks/picture-budget';
import { hookVariantById } from '../../shared/roadtrip/hooks/registry';
import { WinnowError } from '../../shared/sources/winnow/client';
import { fetchPreviewStill, resolvableSource } from '../../shared/sources/winnow/resolve-media';
import { pickable } from './use-slide-library';

/**
 * How long a replaced picture is kept before its bitmap is closed. A render
 * already in flight — `renderBadge` awaits the fonts before it draws, and an
 * export runs for seconds — may still hold the old set, and drawing a closed
 * `ImageBitmap` throws. The stage's own rule is "one commit after"; a picture
 * set also feeds exports, so it waits longer.
 */
const RELEASE_AFTER_MS = 4000;
/** Coalesces a burst of changes — a grade slider dragged — into one pass. */
const SETTLE_MS = 180;
/** A clip that has not shown its frame by then is reported, not waited on. */
const CLIP_FRAME_TIMEOUT_MS = 8000;

const VIDEO_NAME = /\.(mp4|mov|m4v|webm)$/i;

export interface HookPictures {
  pictures: ReadonlyMap<string, HookPicture>;
  status: HookPictureStatus;
}

interface Held {
  /** What the bitmap was decoded for — a change of any of it decodes again. */
  sig: string;
  picture: HookPicture;
}

const EMPTY: ReadonlyMap<string, HookPicture> = new Map();
const NO_PROBLEMS: ReadonlyMap<string, string> = new Map();

/** A stable number per cube, so "the grade changed" is a string compare. */
const lutIds = new WeakMap<CubeLut, number>();
let nextLutId = 1;
function lutToken(lut: CubeLut | null): number {
  if (!lut) return 0;
  let id = lutIds.get(lut);
  if (!id) {
    id = nextLutId++;
    lutIds.set(lut, id);
  }
  return id;
}

/**
 * The count a set's budget is split by, in steps: adding one picture to a
 * sweep of thirty must not decode the other thirty again at a hair smaller.
 * Up to fifteen, every picture already decodes at a delivered frame's size.
 */
function budgetCount(count: number): number {
  if (count <= 15) return 15;
  return [20, 24, 32, 40].find((step) => count <= step) ?? count;
}

/**
 * The pictures a piece's opener asked for (`needs.media === 'day'`), decoded.
 *
 * **The SOURCE picture, never a thumbnail.** The first version read the
 * thumbs store — the 640px JPEG each post keeps of its finished HOOK — and a
 * sweep then flashed other pieces' badges burned into soft pictures. Now each
 * want is a media ref, found where a slide's own picture is found:
 *
 * 1. the Library, by name then content hash (`findMedia`) — a folder's file
 *    or an instance's file already brought in;
 * 2. else the connected instance the ref names, asked for its editing
 *    rendition directly (`fetchPreviewStill`) — one request, and the bytes
 *    are NOT added to the Library: a sweep of forty pictures must not leave
 *    forty assets in the pool;
 * 3. else it is reported, one line per picture (`status.problems`).
 *
 * Each picture is cropped to the frame's shape at decode and sized to what a
 * delivered frame shows, inside one budget the whole set shares
 * (`picture-budget.ts`), then graded with `lut` — the piece's grade, so the
 * flashes and the picture they land on wear the same look. A decoded picture
 * is kept across edits while its source, the frame's shape, its share of the
 * budget and the grade are unchanged, so picking one more picture decodes
 * one more picture.
 */
export default function useHookPictures(
  layers: readonly HookLayer[],
  ctx: HookContext,
  assets: readonly Asset[],
  lut: CubeLut | null,
): HookPictures {
  const wants = useMemo(() => {
    const byKey = new Map<string, HookPictureWant>();
    for (const layer of layers) {
      const variant = hookVariantById(layer.id);
      if (variant?.needs.media !== 'day' || !variant.wantsPictures) continue;
      for (const want of variant.wantsPictures(layer.options ?? {}, ctx)) {
        if (!byKey.has(want.key)) byKey.set(want.key, want);
      }
    }
    return [...byKey.values()];
  }, [layers, ctx]);

  const aspect = ctx.aspect;
  const cap = perPicturePixels(budgetCount(wants.length));
  const grade = lutToken(lut);
  // Everything a pass reads, as one string: the effect runs when an ANSWER
  // changes, never on a new array holding the same wants.
  const wantsKey = wants.map((w) => `${w.key}@${w.atSeconds ?? ''}${w.shape === 'own' ? '~' : ''}`).join('|');
  const passKey = `${wantsKey}#${aspect.toFixed(4)}#${Math.round(cap)}#${grade}`;

  const files = useMemo(() => {
    const out: File[] = [];
    for (const asset of assets) {
      const file = pickable(asset);
      if (file) out.push(file);
    }
    return out;
  }, [assets]);

  const [pictures, setPictures] = useState<ReadonlyMap<string, HookPicture>>(EMPTY);
  const [status, setStatus] = useState<HookPictureStatus>({ pending: 0, problems: NO_PROBLEMS });
  const held = useRef(new Map<string, Held>());
  // Read inside the pass without re-running it for a new array of the same wants.
  const latest = useRef({ wants, files, lut });
  latest.current = { wants, files, lut };

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const { wants: list, files: pool, lut: cube } = latest.current;
        const problems = new Map<string, string>();
        const graders = new Map<string, FrameGrader>();
        const keep = new Set(list.map((w) => w.key));

        // Whatever is no longer wanted leaves the map now and is closed later.
        let changed = false;
        for (const [key, entry] of held.current) {
          if (keep.has(key)) continue;
          held.current.delete(key);
          release(entry.picture);
          changed = true;
        }
        if (changed) setPictures(new Map([...held.current].map(([k, v]) => [k, v.picture])));

        let pending = list.filter((w) => held.current.get(w.key)?.sig !== sigOf(w)).length;
        setStatus({ pending, problems: NO_PROBLEMS });

        function sigOf(want: HookPictureWant): string {
          return `${want.atSeconds ?? ''}#${want.shape ?? 'frame'}#${aspect.toFixed(4)}#${Math.round(cap)}#${grade}`;
        }

        try {
          for (const want of list) {
            if (cancelled) return;
            const sig = sigOf(want);
            if (held.current.get(want.key)?.sig === sig) continue;
            try {
              const picture = await loadPicture(want, pool, aspect, cap, cube, graders);
              if (cancelled) {
                (picture.image as ImageBitmap).close();
                return;
              }
              const before = held.current.get(want.key);
              held.current.set(want.key, { sig, picture });
              if (before) release(before.picture);
              setPictures(new Map([...held.current].map(([k, v]) => [k, v.picture])));
            } catch (err) {
              if (cancelled) return;
              problems.set(want.key, describe(err, want));
            }
            pending -= 1;
            setStatus({ pending, problems: new Map(problems) });
          }
        } finally {
          for (const grader of graders.values()) grader.dispose();
        }
      })();
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `passKey` carries the wants, the frame's shape, the budget and the
    // grade; `files` is the Library, whose change can make a missing picture
    // findable. The rest is read through `latest`.
  }, [passKey, files]);

  useEffect(
    () => () => {
      for (const entry of held.current.values()) (entry.picture.image as ImageBitmap).close();
      held.current.clear();
    },
    [],
  );

  return { pictures, status };
}

/** Close a replaced picture late — see RELEASE_AFTER_MS. Never cancelled. */
function release(picture: HookPicture): void {
  window.setTimeout(() => (picture.image as ImageBitmap).close(), RELEASE_AFTER_MS);
}

class PictureProblem extends Error {}

/** One line a person can act on, for a picture that will not be drawn. */
function describe(err: unknown, want: HookPictureWant): string {
  if (err instanceof PictureProblem) return err.message;
  if (err instanceof WinnowError && err.kind === 'unauthenticated') {
    return `Not signed in to ${resolvableSource(want.ref) ?? 'its instance'}.`;
  }
  return `${want.ref.name}: ${err instanceof Error ? err.message : String(err)}`;
}

/** Find, fetch, decode, crop and grade one picture. Throws with the reason. */
async function loadPicture(
  want: HookPictureWant,
  pool: readonly File[],
  aspect: number,
  cap: number,
  lut: CubeLut | null,
  graders: Map<string, FrameGrader>,
): Promise<HookPicture> {
  const file = await findMedia(want.ref, pool);
  let full: ImageBitmap;
  if (file) {
    full =
      file.type.startsWith('video/') || VIDEO_NAME.test(file.name)
        ? await clipFrame(file, want.atSeconds ?? 0)
        : await decode(file, want.ref.name);
  } else if (VIDEO_NAME.test(want.ref.name)) {
    throw new PictureProblem(
      `${want.ref.name} is a clip that is not in the Library — add it to flash its frame.`,
    );
  } else {
    const blob = await fetchPreviewStill(want.ref);
    if (!blob) {
      throw new PictureProblem(
        `${want.ref.name} is not in the Library, and no connected instance holds it.`,
      );
    }
    full = await decode(blob, want.ref.name);
  }

  try {
    // A print keeps the whole picture at its own shape; a flash is cropped to
    // the frame's, since everything outside it would be decoded for nothing.
    const crop =
      want.shape === 'own'
        ? wholeCrop(full.width, full.height, cap)
        : coverCrop(full.width, full.height, aspect, cap);
    const cropped = await createImageBitmap(
      full,
      Math.round(crop.sx),
      Math.round(crop.sy),
      Math.max(1, Math.round(crop.sw)),
      Math.max(1, Math.round(crop.sh)),
      { resizeWidth: crop.width, resizeHeight: crop.height, resizeQuality: 'high' },
    );
    if (!lut) return { image: cropped, width: cropped.width, height: cropped.height };
    return graded(cropped, lut, graders);
  } finally {
    full.close();
  }
}

async function decode(blob: Blob, name: string): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new PictureProblem(`This browser cannot decode ${name}.`);
  }
}

/**
 * The picture through the piece's grade, as a bitmap of its own. One grader
 * — one WebGL2 context — per SIZE per pass, disposed when the pass ends: a
 * set decoded under one budget is almost always one size.
 */
function graded(
  bitmap: ImageBitmap,
  lut: CubeLut,
  graders: Map<string, FrameGrader>,
): HookPicture {
  const { width, height } = bitmap;
  const size = `${width}x${height}`;
  let grader = graders.get(size);
  if (!grader) {
    grader = makeFrameGrader(lut, width, height);
    graders.set(size, grader);
  }
  try {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d');
    if (!g) return { image: bitmap, width, height };
    // Drawn in the same task as the grade, so the GL canvas still holds it.
    g.drawImage(grader.render(bitmap), 0, 0, width, height);
    const out = canvas.transferToImageBitmap();
    bitmap.close();
    return { image: out, width, height };
  } catch {
    // An ungraded flash is better than a dark one.
    return { image: bitmap, width, height };
  }
}

/** The frame of a clip at `seconds`, decoded by a video element of its own. */
function clipFrame(file: File, seconds: number): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const done = (fn: () => void) => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const fail = () =>
      done(() => reject(new PictureProblem(`This browser cannot show a frame of ${file.name}.`)));
    const timer = window.setTimeout(fail, CLIP_FRAME_TIMEOUT_MS);
    video.onerror = fail;
    video.onloadedmetadata = () => {
      const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : seconds;
      video.currentTime = Math.min(Math.max(0, seconds), end);
    };
    video.onseeked = () => {
      createImageBitmap(video).then(
        (bitmap) => done(() => resolve(bitmap)),
        fail,
      );
    };
    video.src = url;
  });
}
