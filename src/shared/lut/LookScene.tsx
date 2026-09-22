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
 * The wipe is CONTROLLED from the host, because the slider that drives it
 * belongs beside the picture's name, not on top of the photograph.
 *
 * Without WebGL2 it draws the picture through a 2D context, ungraded, and
 * says so: the same degradation every grading path here takes, because an
 * un-graded preview that admits it beats a blank box.
 *
 * ## The picture is shown WHOLE, and that took measuring
 *
 * One box holds it: `absolute inset-0; margin: auto; max-width/height: 100%`
 * plus the picture's own `aspect-ratio`. Measured in Chromium at 16:9, 4:3,
 * 3:2, portrait and 4:1 — it always fits inside the band and always centres.
 *
 * What it replaced was `max-w-full max-h-full` on the canvas in a
 * `place-items-center` grid, and that **silently ignored the height**: a 4:3
 * canvas rendered 400×300 in a 232px band and the rest was clipped by
 * `overflow-hidden`. It looked right only because the reference frame the
 * scene was first driven on is 16:9, exactly the band's own ratio. `width:
 * 100%; height: 100%; object-fit: contain` fails the same way — `height:
 * 100%` does not resolve against the row there either.
 *
 * That box being the PICTURE's box is also what keeps the wipe honest: the
 * divider and the pointer are measured on it, so they agree with the shader,
 * whose split is in the canvas's own coordinates. Positioned on the band
 * instead they would drift apart wherever the picture is letterboxed.
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
 *
 * ## It is looked INTO, like a lightbox and unlike a preview
 *
 * A look is judged on skin, on a sky's gradient, on what a conversion does to
 * a shadow — none of which a picture fitted into a band a few hundred pixels
 * tall can show. So the scene takes `usePictureZoom`, the develop sheet's own
 * gestures (wheel, ⌘/ctrl-wheel or a trackpad pinch, two fingers, a drag that
 * pans once zoomed), and is the one media surface in the suite besides those
 * two that carries the ± pill (`StageZoomControl`, whose "never over a
 * preview" rule is about the framing stages: there the pill fought the
 * picture's own drag, here there is no framing gesture to fight).
 *
 * The ceiling is the lightbox's 8×, not a develop's 4000 %: what is on screen
 * is a 720p raster (`SCENE_PIXELS`), and magnifying a preview pixel says
 * nothing about a look.
 *
 * The wipe keeps the develop sheet's grammar rather than inventing a second
 * one: at the fitted size a press anywhere places the divider; once zoomed a
 * drag pans and only the divider's own handle still wipes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CubeLut } from '../lib/cube-parser';
import StageZoomControl from '../ui/StageZoomControl';
import { MAX_VIEW_ZOOM } from '../ui/pan-zoom';
import { usePictureZoom } from '../ui/use-picture-zoom';
import { createLutRenderer, type LutRenderer } from './lut-gl';
import { sceneFrame, type LutPreviewPicture } from './look-scene';
import type { Interpolation } from './interpolate';

/** Whether a press on the picture places the divider rather than panning. */
function wipeClaims(target: EventTarget | null, zoomed: boolean): boolean {
  const el = target as Element | null;
  if (el?.closest?.('button')) return false;
  return !zoomed || Boolean(el?.closest?.('[data-wipe-handle]'));
}

export interface LookSceneProps {
  /** The host's picture — what the look is judged on. */
  source: LutPreviewPicture;
  /** The aimed look's lattice, or null for the original (and while it loads). */
  cube: CubeLut | null;
  /**
   * How strongly it is applied — `mix(original, graded, intensity)`, the same
   * number a stack layer carries, and the one the pick hands to the host. 1 is
   * the look as authored.
   */
  intensity?: number;
  interpolation: Interpolation;
  /** The before/after wipe, driven by the host's slider. */
  compare: boolean;
  /** Where the divider sits, 0..1 — graded on its left. */
  splitX: number;
  /** A drag across the picture moves the divider too. */
  onSplit: (x: number) => void;
  /** True while the aimed look's lattice is being resolved. */
  busy?: boolean;
  /** Why the aimed look cannot be shown, when it cannot. */
  error?: string | null;
}

export default function LookScene({
  source,
  cube,
  intensity = 1,
  interpolation,
  compare,
  splitX,
  onSplit,
  busy = false,
  error = null,
}: LookSceneProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<LutRenderer | null>(null);
  const [supported, setSupported] = useState(true);

  const frame = sceneFrame(source.width, source.height);

  // What the view is of: the canvas the renderer draws, not the file — the
  // scene works to a pixel budget and `object-contain` fits exactly this.
  const natural = useMemo(
    () => (frame.w && frame.h ? { width: frame.w, height: frame.h } : null),
    [frame.w, frame.h],
  );
  const wiping = useRef(false);
  const live = useRef({ compare, zoomed: false });
  const view = usePictureZoom({
    natural,
    resetKey: source.image,
    ceiling: MAX_VIEW_ZOOM,
    // The wipe and the pan are the same pointer: the hook lets go of exactly
    // the presses the divider answers, and takes the rest.
    claim: (e) => live.current.compare && wipeClaims(e.target, live.current.zoomed),
    onTakeover: () => {
      wiping.current = false;
    },
  });
  live.current = { compare, zoomed: view.zoomed };

  // One renderer per mount, on a canvas of its own (see the note above).
  // Every look afterwards is a uniform change, never a second context.
  useEffect(() => {
    const box = holder.current;
    if (!box) return;
    const fresh = () => {
      const el = document.createElement('canvas');
      // `absolute inset-0` is what makes `object-contain` mean anything: a
      // height of 100% resolves against a definite box there, and the picture
      // is then fitted and centred inside it exactly where `containedSize`
      // says it is — which is what lets the zoom, the divider and the shader
      // agree (`pan-zoom.ts`).
      el.className = 'absolute inset-0 w-full h-full object-contain block';
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
    renderer.setIntensity(intensity);
    renderer.setInterpolation(interpolation);
    renderer.setSplit(compare, splitX);
    try {
      renderer.draw(source.image as TexImageSource);
    } catch {
      // A detached `ImageBitmap` — the host closed it while the picker was
      // open. Painting one throws, and the scene simply stops updating rather
      // than taking the modal down with it.
    }
  }, [source.image, cube, intensity, interpolation, compare, splitX, frame.w, frame.h, supported]);

  // The view, written onto a canvas React does not own. A finger is followed
  // as it moves; a button press is animated.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.transform = view.transform;
    canvas.style.transition = view.settling ? 'transform 220ms var(--ease-paper)' : '';
  }, [view.transform, view.settling, supported]);

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

  // The divider follows a drag across the picture — through the view's own
  // arithmetic, so it lands where the shader puts it at any zoom and pan.
  const wipeFrom = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const x = view.fractionAt(e.clientX, e.clientY).x;
      onSplit(x < 0 ? 0 : x > 1 ? 1 : x);
    },
    [view.fractionAt, onSplit],
  );
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!compare || !wipeClaims(e.target, view.zoomed)) return;
      wiping.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not a live pointer */
      }
      wipeFrom(e);
    },
    [compare, view.zoomed, wipeFrom],
  );

  // Where the picture really sits in the band, so the divider and the two
  // words sit on the PICTURE rather than on the light table around it.
  const { rect } = view;

  return (
    <div
      ref={view.viewportRef}
      // `touch-none`, unlike every drag surface inside a scroll box: this band
      // is `flex-none` in the modal's column and the grid below it is the
      // scroller, so nothing here is taking a scroll away — and a pinch needs
      // both axes.
      className={`relative w-full h-full min-h-0 rounded-control overflow-hidden bg-frame touch-none select-none ${
        view.zoomed
          ? view.panning
            ? 'cursor-grabbing'
            : 'cursor-grab'
          : compare
            ? 'cursor-col-resize'
            : 'cursor-default'
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (wiping.current) wipeFrom(e);
      }}
      onPointerUp={() => {
        wiping.current = false;
      }}
      onPointerCancel={() => {
        wiping.current = false;
      }}
    >
      {/* The canvas is appended here by the effect — React never owns it. It
          fills this box and is fitted inside it by `object-contain`. */}
      <div ref={holder} className="absolute inset-0" />

      {compare && (
        <>
          {/* A grab strip, not a hairline: once zoomed this is the only thing
              that still wipes instead of panning, so it has to be reachable
              with a finger. */}
          <div
            data-wipe-handle
            className="absolute w-7 -ml-3.5 cursor-col-resize group"
            style={{
              left: rect.x + splitX * rect.width,
              top: Math.max(0, rect.y),
              height: Math.max(0, Math.min(view.viewport.height, rect.y + rect.height) - Math.max(0, rect.y)),
            }}
            title="Drag to compare with the original"
            aria-hidden="true"
          >
            <span className="absolute inset-y-0 left-1/2 w-0.5 -ml-px bg-paper/90 pointer-events-none" />
            {view.zoomed && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full bg-[rgba(251,248,241,0.92)] border border-line-strong text-ink-soft shadow-paper group-hover:border-accent group-hover:text-accent-ink pointer-events-none">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
                </svg>
              </span>
            )}
          </div>
          {/* The two words name the picture's own halves, so they are drawn
              only while both are on screen: panned into a corner at 4×, a
              "Graded" pinned to the band would be naming whatever happens to
              be under it. */}
          {!view.zoomed && (
            <>
              <span
                className="absolute px-1.5 py-0.5 rounded-full bg-frame/70 font-mono text-3xs tracking-[0.1em] uppercase text-paper pointer-events-none"
                style={{ left: rect.x + 8, top: rect.y + rect.height - 26 }}
              >
                Graded
              </span>
              <span
                className="absolute px-1.5 py-0.5 rounded-full bg-frame/70 font-mono text-3xs tracking-[0.1em] uppercase text-paper pointer-events-none"
                style={{ left: rect.x + rect.width - 8, top: rect.y + rect.height - 26, transform: 'translateX(-100%)' }}
              >
                Original
              </span>
            </>
          )}
        </>
      )}

      {/* The way back from a zoom, drawn at every width and at rest too: a
          trackpad pinch and a wheel are not on every device, and a control
          that appears only once you are lost is not a way out. */}
      <StageZoomControl
        zoom={view.zoom}
        hint="wheel, or pinch"
        className="absolute top-2 left-2 shadow-paper"
      />

      {busy && (
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-frame/70 font-mono text-3xs text-paper">
          Reading…
        </span>
      )}

      {(error || !supported) && (
        <p className="absolute inset-x-2 bottom-2 m-0 px-2 py-1.5 rounded-control bg-frame/80 text-2xs leading-snug text-paper">
          {error ??
            'Your browser does not expose WebGL2, so this is your picture ungraded — the looks below are still right.'}
        </p>
      )}
    </div>
  );
}
