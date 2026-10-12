import { useEffect, useMemo, useRef, useState } from 'react';
import { useZoomGestures } from '../../shared/ui/use-zoom-gestures';
import type { ZoomTarget } from '../../shared/ui/zoom-gestures';
import { ensureFontFaces } from '../../shared/overlay/fonts';
import { HUD_FONT_FACES, paintAtlas, type PaintScene } from './atlas-paint';
import type { AtlasTiles } from './atlas-tiles';
import { aspectRatio, type AtlasSettings } from './atlas-settings';
import { panView, zoomViewAbout, type AtlasView } from './atlas-view';
import type { SceneCore } from './use-atlas-scene';
import type { PlayClock } from './play-clock';

interface AtlasStageProps {
  core: SceneCore;
  viewAt: (t: number) => AtlasView;
  clock: PlayClock;
  tiles: AtlasTiles | null;
  focus: number | null;
  aspect: AtlasSettings['aspect'];
  look: { bearing: number; tilt: number };
  /** The hand moved the map: the camera becomes free at this view. */
  onFreeView: (view: AtlasView) => void;
  /** Bumped by whoever wants a repaint (a tile landed). */
  paintSeq: number;
}

/**
 * The atlas on screen: a canvas letterboxed to the export's aspect inside
 * whatever room the column leaves, painted by the export's own painter on
 * every animation frame while playing and on every change while paused.
 * The wheel, a pinch and a drag move the map through the suite's one
 * reading of the hand (`use-zoom-gestures.ts`); any of them hands the
 * camera to the author.
 */
export default function AtlasStage({ core, viewAt, clock, tiles, focus, aspect, look, onFreeView, paintSeq }: AtlasStageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ensureFontFaces(HUD_FONT_FACES).then(() => !cancelled && setFontsReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The room the column gives, measured — never the canvas's own size.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setRoom({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ar = aspectRatio(aspect);
  const size = useMemo(() => {
    if (room.w <= 0 || room.h <= 0) return { w: 0, h: 0 };
    const w = Math.min(room.w, room.h * ar);
    return { w: Math.floor(w), h: Math.floor(w / ar) };
  }, [room, ar]);

  // What the loop paints from, refreshed every render without restarting it.
  const live = useRef({ core, viewAt, tiles, focus, size });
  live.current = { core, viewAt, tiles, focus, size };
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  }, [core, viewAt, tiles, focus, size, paintSeq, fontsReady]);
  useEffect(() => clock.subscribe(() => (dirty.current = true)), [clock]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock.tick(dt);
      const canvas = canvasRef.current;
      const { core: c, viewAt: v, tiles: tl, focus: fo, size: sz } = live.current;
      if (canvas && sz.w > 0 && dirty.current) {
        dirty.current = false;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.round(sz.w * dpr);
        const H = Math.round(sz.h * dpr);
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W;
          canvas.height = H;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const scene: PaintScene = { ...c, tiles: tl, focus: fo };
          paintAtlas(ctx, scene, { t: clock.t, view: v(clock.t), width: W, height: H });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  // The hand: zoom about the pointer, drag to pan — on the view shown now.
  const target: ZoomTarget = {
    scaleAt: () => viewAt(clock.t).scale,
    zoomTo: (scale, anchor) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const cur = viewAt(clock.t);
      onFreeView(zoomViewAbout(cur, look, r.width, r.height, scale / cur.scale, anchor.x - r.left, anchor.y - r.top));
    },
    panBy: (dx, dy) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      onFreeView(panView(viewAt(clock.t), look, r.width, r.height, dx, dy));
    },
    drag: () => 'pan',
  };
  useZoomGestures({ ref: boxRef, target, wheel: 'any' });

  return (
    <div ref={boxRef} className="relative flex-1 min-h-0 min-w-0 grid place-items-center overflow-hidden touch-none select-none cursor-grab active:cursor-grabbing">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        className="block rounded-paper shadow-paper-soft"
        aria-label="Flight Atlas animation"
      />
    </div>
  );
}
