import { useEffect, useMemo, useRef, useState } from 'react';
import { useZoomGestures } from '../../shared/ui/use-zoom-gestures';
import type { DragHandler, ZoomTarget } from '../../shared/ui/zoom-gestures';
import { ensureFontFaces } from '../../shared/overlay/fonts';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import type { WorldBox } from './atlas-flight';
import { HUD_FONT_FACES, paintAtlas, type PaintScene } from './atlas-paint';
import type { AtlasTiles } from './atlas-tiles';
import { aspectRatio, mapRect, type FormatSettings } from './atlas-settings';
import { invertAffine, panView, viewAffine, zoomViewAbout, type AtlasView } from './atlas-view';
import type { SceneCore } from './use-atlas-scene';
import type { PlayClock } from './play-clock';

interface AtlasStageProps {
  core: SceneCore;
  viewAt: (t: number) => AtlasView;
  clock: PlayClock;
  tiles: AtlasTiles | null;
  focus: number | null;
  format: FormatSettings;
  theme: StyleTheme;
  look: { bearing: number; tilt: number };
  /** The hand moved the map: the camera becomes free at this view. */
  onFreeView: (view: AtlasView) => void;
  /** While true, a drag draws the zone to frame instead of moving the map. */
  drawingZone: boolean;
  onZone: (box: WorldBox) => void;
  /** Bumped by whoever wants a repaint (a tile landed). */
  paintSeq: number;
}

/**
 * The atlas on screen: a canvas letterboxed to the export's shape inside
 * whatever room the column leaves, painted by the export's own painter on
 * every animation frame while playing and on every change while paused.
 * The wheel, a pinch and a drag move the map through the suite's one
 * reading of the hand (`use-zoom-gestures.ts`) — measured inside the mount,
 * where the map is — and any of them hands the camera to the author. While
 * a zone is being drawn, a drag draws it.
 */
export default function AtlasStage(props: AtlasStageProps) {
  const { core, viewAt, clock, tiles, focus, format, theme, look, onFreeView, drawingZone, onZone, paintSeq } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(0);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const face = `${theme.style.italic ? 'italic ' : ''}${theme.style.weight} 32px '${theme.style.fontFamily}'`;
  useEffect(() => {
    let cancelled = false;
    void ensureFontFaces([...HUD_FONT_FACES, face]).then(() => !cancelled && setFontsReady((n) => n + 1));
    return () => {
      cancelled = true;
    };
  }, [face]);

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

  const ar = aspectRatio(format.aspect);
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

  /** The map's rectangle on screen, in client pixels. */
  const mapOnScreen = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const m = mapRect(format, r.width, r.height);
    return { left: r.left + m.x, top: r.top + m.y, w: m.w, h: m.h };
  };

  // The hand: zoom about the pointer, drag to pan — on the view shown now.
  const target: ZoomTarget = {
    scaleAt: () => viewAt(clock.t).scale,
    zoomTo: (scale, anchor) => {
      const r = mapOnScreen();
      if (!r) return;
      const cur = viewAt(clock.t);
      onFreeView(zoomViewAbout(cur, look, r.w, r.h, scale / cur.scale, anchor.x - r.left, anchor.y - r.top));
    },
    panBy: (dx, dy) => {
      const r = mapOnScreen();
      if (!r) return;
      onFreeView(panView(viewAt(clock.t), look, r.w, r.h, dx, dy));
    },
    drag: (start) => {
      if (!drawingZone) return 'pan';
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return null;
      const x0 = start.x;
      const y0 = start.y;
      setBand({ x0: x0 - box.left, y0: y0 - box.top, x1: x0 - box.left, y1: y0 - box.top });
      const handler: DragHandler = {
        move: (m) => setBand({ x0: x0 - box.left, y0: y0 - box.top, x1: m.x - box.left, y1: m.y - box.top }),
        end: (e) => {
          setBand(null);
          const r = mapOnScreen();
          if (!r || e.cancelled || Math.abs(e.totalX) < 8 || Math.abs(e.totalY) < 8) return;
          // The rectangle's four corners back to the world, through the view shown.
          const inv = invertAffine(viewAffine(viewAt(clock.t), look, r.w, r.h));
          const xs: number[] = [];
          const ys: number[] = [];
          for (const [cx, cy] of [
            [x0, y0],
            [x0 + e.totalX, y0],
            [x0, y0 + e.totalY],
            [x0 + e.totalX, y0 + e.totalY],
          ]) {
            const px = cx - r.left;
            const py = cy - r.top;
            xs.push(inv.a * px + inv.c * py + inv.e);
            ys.push(inv.b * px + inv.d * py + inv.f);
          }
          onZone({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
        },
      };
      return handler;
    },
  };
  useZoomGestures({ ref: boxRef, target, wheel: 'any' });

  return (
    <div
      ref={boxRef}
      className={`relative flex-1 min-h-0 min-w-0 grid place-items-center overflow-hidden touch-none select-none ${
        drawingZone ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        className="block rounded-paper shadow-paper-soft"
        aria-label="Flight Atlas animation"
      />
      {band && (
        <span
          className="absolute border-2 border-accent bg-accent/15 pointer-events-none rounded-sm"
          style={{
            left: Math.min(band.x0, band.x1),
            top: Math.min(band.y0, band.y1),
            width: Math.abs(band.x1 - band.x0),
            height: Math.abs(band.y1 - band.y0),
          }}
        />
      )}
      {drawingZone && !band && (
        <span className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-on-media bg-black/60 px-3 py-1.5 rounded-full pointer-events-none">
          Drag a rectangle on the map — the wheel still zooms
        </span>
      )}
    </div>
  );
}
