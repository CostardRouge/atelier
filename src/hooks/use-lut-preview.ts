import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CubeLut } from '../lib/cube-parser';
import { createLutRenderer, type LutRenderer } from '../lut/lut-gl';

/**
 * Drive a {@link LutRenderer}: paint each displayed video frame into a canvas,
 * graded through the active LUT.
 *
 * Mirrors `use-active-cue.ts`: it prefers `requestVideoFrameCallback` (fires
 * once per presented frame, so the canvas tracks the video exactly) and falls
 * back to `requestAnimationFrame`. The LUT itself lives inside the renderer, so
 * the per-frame loop only ever calls `draw` — swapping LUTs doesn't touch it.
 *
 * @param videoRef The source `<video>` (decoded by the browser).
 * @param canvasRef The `<canvas>` to paint.
 * @param lut Active LUT, or null to render ungraded.
 * @param bypass When true, ignore `lut` and show the original (A/B compare).
 * @param resetKey Changes when the video source swaps (the object URL);
 *   re-creates the renderer and restarts the loop.
 * @returns `supported` is false when WebGL2 is unavailable; `setSplit` drives
 *   the before/after wipe imperatively (no React state churn on pointer move).
 */
export function useLutPreview(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  lut: CubeLut | null,
  bypass: boolean,
  resetKey?: unknown,
): { supported: boolean; setSplit: (active: boolean, x: number) => void } {
  const [supported, setSupported] = useState(true);
  const rendererRef = useRef<LutRenderer | null>(null);

  // Create the renderer and run the per-frame paint loop. Re-runs when the
  // source swaps so the old GL resources are released first.
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const renderer = createLutRenderer(canvas);
    if (!renderer) {
      setSupported(false);
      return;
    }
    rendererRef.current = renderer;
    setSupported(true);

    // Seed with the current LUT/bypass state before the first paint.
    renderer.setLut(bypass ? null : lut);

    let cancelled = false;
    let rvfcHandle = 0;
    let rafHandle = 0;

    const paint = () => {
      if (cancelled || video.readyState < 2) return;
      renderer.resize(video.videoWidth, video.videoHeight);
      renderer.draw(video);
    };

    const supportsRVFC = typeof video.requestVideoFrameCallback === 'function';
    if (supportsRVFC) {
      const onFrame: VideoFrameRequestCallback = () => {
        if (cancelled) return;
        paint();
        rvfcHandle = video.requestVideoFrameCallback(onFrame);
      };
      rvfcHandle = video.requestVideoFrameCallback(onFrame);
    } else {
      const loop = () => {
        if (cancelled) return;
        paint();
        rafHandle = requestAnimationFrame(loop);
      };
      rafHandle = requestAnimationFrame(loop);
    }

    // rVFC only fires while frames advance (i.e. playing). Paint once on these
    // events so a paused first frame and post-seek frames still show.
    const onReady = () => paint();
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('seeked', onReady);

    return () => {
      cancelled = true;
      if (supportsRVFC && rvfcHandle) video.cancelVideoFrameCallback(rvfcHandle);
      if (rafHandle) cancelAnimationFrame(rafHandle);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('seeked', onReady);
      renderer.dispose();
      rendererRef.current = null;
    };
    // Intentionally keyed only on the source: lut/bypass are applied by the
    // effect below; seeding them here just avoids a black first frame.
  }, [resetKey, canvasRef, videoRef]);

  // Apply LUT / bypass changes and repaint immediately so a paused frame
  // updates without waiting for the next presented frame.
  useEffect(() => {
    const renderer = rendererRef.current;
    const video = videoRef.current;
    if (!renderer) return;
    renderer.setLut(bypass ? null : lut);
    if (video && video.readyState >= 2) {
      renderer.resize(video.videoWidth, video.videoHeight);
      renderer.draw(video);
    }
  }, [lut, bypass, videoRef]);

  // Set the wipe position and repaint at once, so dragging the divider over a
  // paused frame updates immediately. Stable identity: reads the live refs.
  const setSplit = useCallback(
    (active: boolean, x: number) => {
      const renderer = rendererRef.current;
      const video = videoRef.current;
      if (!renderer) return;
      renderer.setSplit(active, x);
      if (video && video.readyState >= 2) {
        renderer.resize(video.videoWidth, video.videoHeight);
        renderer.draw(video);
      }
    },
    [videoRef],
  );

  return { supported, setSplit };
}
