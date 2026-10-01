import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelapseScript } from '../../shared/develop/timelapse-script';
import { ensureOverlayFonts } from '../../shared/overlay/fonts';
import { themeFromPreset } from '../../shared/overlay/title-styles';
import { prepareTimelapse, type StateCache, type TimelapsePainter, type TimelapseSource } from './timelapse-paint';
import type { RollCubes } from './roll-cubes';

/** The preview's long edge — enough to judge the grammar, cheap to render. */
export const PREVIEW_EDGE = 800;
/** The picture is decoded for the preview at this long edge, whatever the camera's zoom. */
export const PREVIEW_DECODE_EDGE = 1600;

export interface TimelapsePreview {
  /** Hand the page's canvas to the painter. */
  canvasRef: (el: HTMLCanvasElement | null) => void;
  /** The canvas's own pixels, for its `width`/`height` attributes. */
  size: { width: number; height: number };
  /** Every state rendered and the painter ready to draw. */
  ready: boolean;
  /** How many states are rendered of how many, while preparing. */
  progress: { done: number; total: number } | null;
  error: string | null;
  t: number;
  playing: boolean;
  toggle: () => void;
  seek: (t: number) => void;
}

/** The preview canvas's pixels for a frame of `width` × `height`: the long edge at `PREVIEW_EDGE`. */
export function previewSize(width: number, height: number): { width: number; height: number } {
  const k = PREVIEW_EDGE / Math.max(width, height);
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * The making-of played on a canvas through the export's own painter — so the
 * preview IS the file, scaled. The states are rendered once per source (a
 * cache the painter keeps across prepares, so hiding a chapter or changing
 * the length renders nothing new); the script's words, timing and options
 * redraw the current frame at once. Playing loops.
 */
export function useTimelapsePreview({
  script,
  source,
  cubes,
}: {
  script: TimelapseScript;
  /** Null while the picture's bytes are not in hand. */
  source: TimelapseSource | null;
  cubes: RollCubes;
}): TimelapsePreview {
  const size = previewSize(script.width, script.height);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const painter = useRef<TimelapsePainter | null>(null);
  const cache = useRef<StateCache | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const tRef = useRef(0);

  // The states' identities: what a prepare is keyed on, never the script object.
  const statesKey = `${script.states.length}:${script.chapters.length}`;
  // The source by what it IS, not by its object: a host that rebuilds it per
  // render must not restart the preparation.
  const sourceRef = useRef(source);
  const sameSource =
    sourceRef.current === source ||
    (sourceRef.current !== null &&
      source !== null &&
      sourceRef.current.file === source.file &&
      (sourceRef.current.raw?.file ?? null) === (source.raw?.file ?? null) &&
      (sourceRef.current.raw?.gain ?? null) === (source.raw?.gain ?? null) &&
      sourceRef.current.calibration === source.calibration);
  if (!sameSource) sourceRef.current = source;
  const stableSource = sourceRef.current;
  const statesRef = useRef(script.states);
  const sameStates = statesRef.current.length === script.states.length && statesRef.current.every((s, i) => s === script.states[i]);
  if (!sameStates) statesRef.current = script.states;
  const states = statesRef.current;

  useEffect(() => {
    if (!canvas || !stableSource) {
      setReady(false);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setReady(false);
    setError(null);
    setProgress({ done: 0, total: states.length });
    void prepareTimelapse(scriptRef.current, stableSource, {
      cubes,
      edge: PREVIEW_DECODE_EDGE,
      size,
      canvas,
      signal: controller.signal,
      cache: cache.current,
      onProgress: (done, total) => {
        if (alive) setProgress({ done, total });
      },
    })
      .then((p) => {
        if (!alive) {
          // A later prepare took over; keep its cache for it.
          return;
        }
        painter.current = p;
        cache.current = p.cache;
        setProgress(null);
        setReady(true);
        if (p.has(scriptRef.current)) p.draw(scriptRef.current, tRef.current);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
        setProgress(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
    // `states` is what `statesKey` stands for; `size` follows the script's format.
  }, [canvas, stableSource, cubes, states, statesKey, size.width, size.height]);

  // Let the rasters go with the sheet.
  useEffect(
    () => () => {
      painter.current = null;
      cache.current?.dispose();
      cache.current = null;
    },
    [],
  );

  // Redraw the frame when the script or the time moves.
  useEffect(() => {
    const p = painter.current;
    if (!ready || !p || !p.has(script)) return;
    p.draw(script, t);
  }, [script, t, ready]);

  // A face picked after the prepare is loaded, then the frame redrawn — or the
  // canvas draws a fallback until something else re-prepares.
  const font = script.options.style ? `${script.options.style.font}|${script.options.style.bold}` : null;
  useEffect(() => {
    if (!ready || !font) return;
    let alive = true;
    void ensureOverlayFonts(scriptRef.current.overlays, themeFromPreset('neutral')).then(() => {
      const p = painter.current;
      if (alive && p && p.has(scriptRef.current)) p.draw(scriptRef.current, tRef.current);
    });
    return () => {
      alive = false;
    };
  }, [font, ready]);

  // The clock: a rAF loop while playing, looping at the end.
  useEffect(() => {
    if (!playing || !ready) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const seconds = scriptRef.current.seconds;
      let next = tRef.current + dt;
      if (next >= seconds) next = 0;
      tRef.current = next;
      setT(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, ready]);

  const seek = useCallback((next: number) => {
    tRef.current = Math.max(0, Math.min(scriptRef.current.seconds, next));
    setT(tRef.current);
  }, []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const canvasRef = useCallback((el: HTMLCanvasElement | null) => setCanvas(el), []);

  return { canvasRef, size, ready, progress, error, t, playing, toggle, seek };
}
