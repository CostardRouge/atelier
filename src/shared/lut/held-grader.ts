/**
 * Grade a picture once, draw it many times.
 *
 * An editor stage repaints on every step of a drag — the badge block, the
 * picture's pan and zoom, a selection — and each repaint used to send the
 * whole picture through the grader again: a texture upload and a full-frame
 * shader pass for a picture that had not changed. Measured on a 1600 px Trips
 * stage (Chromium, Apple silicon): 31 ms a paint for a 12 MP photo and 103 ms
 * for a 48 MP one, against 6 ms for the same picture ungraded.
 *
 * So the grade is HELD: the grader runs again only for a different picture, or
 * after `invalidate()` — a clip's element stays the same object while its
 * frame moves, so only the caller knows when that happened.
 *
 * Holding the grader's own canvas is not enough on its own: a WebGL canvas
 * drawn into a 2D canvas is copied on EVERY draw, so its cost follows its
 * size (13 ms at a 4K frame, 38 ms at 48 MP). A plain 2D surface is uploaded
 * once and then drawn like any decoded photo — ~6 ms at any size. The copy
 * is taken on the SECOND paint of an unchanged picture, never the first: a
 * strength slider or a playing clip changes the picture on every paint, and
 * must not pay a readback (~3 ms at a 4K frame) for a result it throws away.
 */

import type { FrameGrader, GradeSource, PassGrader } from './frame-grader';
import type { RenderPass } from '../render/graph';

export type RasterSurface = OffscreenCanvas | HTMLCanvasElement;

/**
 * Copy `picture` into `into` when it is already the right size, or into a new
 * surface; null when it cannot (not a canvas, no 2D context). Injected so the
 * holding logic stays testable without a DOM.
 */
export type CopyPicture = (
  picture: CanvasImageSource,
  into: RasterSurface | null,
) => RasterSurface | null;

export interface HeldGrader extends FrameGrader {
  /** Forget the held grade: the next render grades again. */
  invalidate(): void;
  /**
   * Change the passes under the held grade, where the grader supports it
   * (`PassGrader`) — and forget the held copy, since the picture it holds was
   * made with the old ones. Absent for a grader that cannot.
   */
  setPasses?: (passes: readonly RenderPass[]) => void;
}

function isCanvas(source: GradeSource): source is RasterSurface {
  return (
    (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) ||
    (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)
  );
}

/**
 * The browser copy: a CPU-backed 2D surface (`willReadFrequently`), which is
 * what makes the browser upload it once and cache it — a GPU-backed
 * OffscreenCanvas measured as slow to draw as the WebGL canvas itself.
 */
export const copyToRaster: CopyPicture = (picture, into) => {
  if (!isCanvas(picture) || picture.width <= 0 || picture.height <= 0) return null;
  const { width, height } = picture;
  let surface = into;
  if (!surface || surface.width !== width || surface.height !== height) {
    if (typeof OffscreenCanvas !== 'undefined') {
      surface = new OffscreenCanvas(width, height);
    } else if (typeof document !== 'undefined') {
      surface = document.createElement('canvas');
      surface.width = width;
      surface.height = height;
    } else {
      return null;
    }
  }
  const ctx = surface.getContext('2d', { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  // Replace, never blend: a graded picture with transparency must not keep
  // the last copy showing through it.
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(picture, 0, 0);
  return surface;
};

/**
 * Wrap a grader so it grades each picture once. Disposing the wrapper
 * disposes the grader it holds.
 */
export function holdGrades(inner: FrameGrader, copy: CopyPicture = copyToRaster): HeldGrader {
  let source: GradeSource | null = null;
  let graded: CanvasImageSource | null = null;
  let held: RasterSurface | null = null;
  let surface: RasterSurface | null = null;
  let copyTried = false;
  const swappable = (inner as Partial<PassGrader>).setPasses;

  return {
    ...(swappable
      ? {
          setPasses(passes: readonly RenderPass[]) {
            swappable.call(inner, passes);
            // The held copy was graded through the passes that just left.
            graded = null;
            held = null;
          },
        }
      : {}),
    render(next) {
      if (graded === null || next !== source) {
        graded = inner.render(next);
        source = next;
        held = null;
        copyTried = false;
        return graded;
      }
      if (held) return held;
      // A pass-through grader (no WebGL2) hands the source back: nothing to copy.
      if (graded === next || copyTried) return graded;
      copyTried = true;
      const copied = copy(graded, surface);
      if (!copied) return graded;
      surface = copied;
      held = copied;
      return held;
    },
    invalidate() {
      graded = null;
      held = null;
    },
    dispose() {
      inner.dispose();
      source = null;
      graded = null;
      held = null;
      surface = null;
    },
  };
}
