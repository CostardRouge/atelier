/**
 * The aimed look, drawn on the host's own picture.
 *
 * It grades through `createLutRenderer` — the very renderer the LUT Studio's
 * preview and every export use — so the scene and the delivered picture
 * cannot disagree about what a look does. ONE renderer for the whole life of
 * the picker: a look change is `setLut` plus a draw, never a new WebGL2
 * context, which is the one resource a page has a hard cap on
 * (`media-pipeline.md`, «A failed export can silently break every export
 * after it»). It is disposed on unmount, which loses the context rather than
 * leaving its slot to the garbage collector.
 *
 * The before/after wipe is not new either: `setSplit` has been in the shader
 * all along, graded on the LEFT and the original on the right, the way
 * Lightroom and Capture One put it — and the way `LutStudio` already reads.
 *
 * Without WebGL2 it draws the picture through a 2D context, ungraded, and
 * says so: the same degradation every grading path here takes, because an
 * un-graded preview that admits it beats a blank box.
 *
 * ## It OWNS its canvas, and that is not a style choice
 *
 * The canvas is created here and thrown away with the renderer, never a
 * `<canvas>` React keeps across mounts — measured in a browser, twice over:
 *
 * - `dispose()` calls `WEBGL_lose_context.loseContext()` (it must: deleting
 *   the objects frees their memory but not the context SLOT, which a page has
 *   a hard cap of about sixteen of). A canvas whose context was lost that way
 *   hands back **the same dead context** on the next `getContext('webgl2')`,
 *   and every shader compiled on it fails with a **null** info log. React
 *   `StrictMode` double-invokes an effect — mount, clean up, mount — so on the
 *   same DOM node the second renderer was born dead and the scene drew black.
 * - asking a canvas for `webgl2` TAINTS it: `getContext('2d')` on it returns
 *   null forever after. So the ungraded fallback cannot reuse the canvas the
 *   failed attempt touched, and gets one of its own.
 *
 * Rule for anything else here that creates a grader per mount: own the
 * canvas, or inherit both bugs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CubeLut } from '../lib/cube-parser';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import { createLutRenderer, type LutRenderer } from './lut-gl';
import { sceneFrame, type LutPreviewPicture } from './look-scene';
import type { Interpolation } from './interpolate';

export interface LookSceneProps {
  /** The host's picture — what the look is judged on. */
  source: LutPreviewPicture;
  /** The aimed look's lattice, or null for the original (and while it loads). */
  cube: CubeLut | null;
  interpolation: Interpolation;
  /** True while the aimed look's lattice is being resolved. */
  busy?: boolean;
  /** Why the aimed look cannot be shown, when it cannot. */
  error?: string | null;
}

export default function LookScene({
  source,
  cube,
  interpolation,
  busy = false,
  error = null,
}: LookSceneProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<LutRenderer | null>(null);
  const [supported, setSupported] = useState(true);
  /** Off by default: the answer wanted first is the graded picture. */
  const [compare, setCompare] = useState(false);
  const [splitX, setSplitX] = useState(0.5);

  const frame = sceneFrame(source.width, source.height);

  // One renderer per mount, on a canvas of its own (see the note above).
  // Every look afterwards is a uniform change, never a second context.
  useEffect(() => {
    const box = holder.current;
    if (!box) return;
    const fresh = () => {
      const el = document.createElement('canvas');
      el.className = 'max-w-full max-h-full block';
      box.appendChild(el);
      return el;
    };
    let canvas = fresh();
    const renderer = createLutRenderer(canvas);
    if (!renderer) {
      // The attempt tainted it: a 2D context is no longer available there.
      canvas.remove();
      canvas = fresh();
    }
    canvasRef.current = canvas;
    rendererRef.current = renderer;
    setSupported(!!renderer);
    return () => {
      rendererRef.current = null;
      canvasRef.current = null;
      renderer?.dispose();
      canvas.remove();
    };
  }, []);

  // Everything the picture depends on, in one draw. The source is re-uploaded
  // per draw, which at the scene's budget is a megapixel — cheap enough that
  // splitting this into "upload" and "grade" effects would buy nothing and
  // could let the two get out of step.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !frame.w || !frame.h) return;
    void supported;
    renderer.resize(frame.w, frame.h);
    renderer.setLut(cube);
    renderer.setIntensity(1);
    renderer.setInterpolation(interpolation);
    renderer.setSplit(compare, splitX);
    try {
      renderer.draw(source.image as TexImageSource);
    } catch {
      // A detached `ImageBitmap` — the host closed it while the picker was
      // open. Painting one throws, and the scene simply stops updating rather
      // than taking the modal down with it.
    }
  }, [source.image, cube, interpolation, compare, splitX, frame.w, frame.h, supported]);

  // No WebGL2: the picture, ungraded, through a 2D context.
  useEffect(() => {
    if (supported) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !frame.w) return;
    canvas.width = frame.w;
    canvas.height = frame.h;
    try {
      ctx.drawImage(source.image, 0, 0, frame.w, frame.h);
    } catch {
      /* same detached-bitmap case as above */
    }
  }, [supported, source.image, frame.w, frame.h]);

  // The divider follows the pointer while comparing, as it does in the LUT
  // Studio. `pan-y` and never `none`: the modal's body scrolls under this,
  // and a surface that claims both axes leaves a finger no way out.
  const track = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!compare) return;
      const box = e.currentTarget.getBoundingClientRect();
      if (!box.width) return;
      const x = (e.clientX - box.left) / box.width;
      setSplitX(x < 0 ? 0 : x > 1 ? 1 : x);
    },
    [compare],
  );

  return (
    <div className="relative h-full min-h-0 flex-none rounded-control overflow-hidden bg-frame">
      {/* The canvas is appended here by the effect — React never owns it. */}
      <div
        ref={holder}
        className="w-full h-full grid place-items-center touch-pan-y"
        onPointerMove={track}
        onPointerDown={track}
      />

      {compare && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-paper/90 pointer-events-none"
            style={{ left: `${splitX * 100}%` }}
          />
          <span className="absolute left-2 bottom-2 px-1.5 py-0.5 rounded-full bg-frame/70 font-mono text-3xs tracking-[0.1em] uppercase text-paper pointer-events-none">
            Graded
          </span>
          <span className="absolute right-2 bottom-2 px-1.5 py-0.5 rounded-full bg-frame/70 font-mono text-3xs tracking-[0.1em] uppercase text-paper pointer-events-none">
            Original
          </span>
        </>
      )}

      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        {busy && (
          <span className="px-2 py-0.5 rounded-full bg-frame/70 font-mono text-3xs text-paper">
            Reading…
          </span>
        )}
        <IconButton
          label={compare ? 'Stop comparing' : 'Compare with the original'}
          // `md`, not `sm`: 34px is what every other icon button in the suite
          // is, and a 28px target over a photograph is a thumb's problem.
          variant="ghost"
          aria-pressed={compare}
          onClick={() => setCompare((v) => !v)}
          className={
            compare
              ? 'bg-accent text-paper border-accent-ink'
              : 'bg-frame/60 text-paper border-paper/30'
          }
        >
          {Icons.swap}
        </IconButton>
      </div>

      {(error || !supported) && (
        <p className="absolute inset-x-2 bottom-2 m-0 px-2 py-1.5 rounded-control bg-frame/80 text-2xs leading-snug text-paper">
          {error ??
            'Your browser does not expose WebGL2, so this is your picture ungraded — the looks below are still right.'}
        </p>
      )}
    </div>
  );
}
