import { useEffect, useMemo, useRef, useState } from 'react';
import { useZoomGestures } from '../../shared/ui/use-zoom-gestures';
import { DRAG_SLOP, type DragHandler, type ZoomTarget } from '../../shared/ui/zoom-gestures';
import { ensureFontFaces } from '../../shared/overlay/fonts';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import type { WorldBox } from './atlas-flight';
import { frameFontFaces, paintAtlas, type PaintedFrame, type PaintScene } from './atlas-paint';
import { hitAt, nearFlight, unionOf, type AtlasLayer } from './atlas-layers';
import { dropPlacement, PIECE_LAYER, pieceAt, pieceBox, withPlacement, type PieceId, type Placement } from './atlas-place';
import type { AtlasTiles } from './atlas-tiles';
import { aspectRatio, mapRect, type FormatSettings } from './atlas-settings';
import { invertAffine, panView, viewAffine, zoomViewAbout, type AtlasView } from './atlas-view';
import { cameraHeldBy } from './atlas-story';
import { safeRect } from './atlas-safe';
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
  /** The inspector's layer, outlined on the picture where it is drawn. */
  selected: AtlasLayer;
  /** A click (not a drag) landed on something: open its layer. */
  onPick: (layer: AtlasLayer) => void;
  /** A piece of the overlay was dragged and let go: back in a spot, or held where it is. */
  onPlace: (piece: PieceId, place: Placement) => void;
}

const SPOT_WORDS = { tl: 'top left', tc: 'top', tr: 'top right', bl: 'bottom left', bc: 'bottom', br: 'bottom right' } as const;

/** What the chip says when the story holds the camera and the hand tried to move it. */
const HELD_WORDS = {
  dive: 'The world dive moves the camera here — zoom once the flights start',
  pull: 'The pull-back moves the camera here — zoom during the flights',
} as const;

/** CSS pixels around a piece or a line within which a click still lands on it. */
const REACH = 8;

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
  const { core, viewAt, clock, tiles, focus, format, theme, look, onFreeView, drawingZone, onZone, paintSeq, selected, onPick, onPlace } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outlineRef = useRef<HTMLSpanElement>(null);
  /** Where the last frame drew things, canvas pixels, and the scale to CSS. */
  const painted = useRef<{ frame: PaintedFrame; dpr: number } | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(0);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** The piece being dragged and where it would land now — painted, not yet written. */
  const dragging = useRef<{ piece: PieceId; place: Placement } | null>(null);
  const [snapWord, setSnapWord] = useState<string | null>(null);
  // The social apps' zones show while they are kept clear and the frame's own settings are open — never in the file.
  const safeShown = format.safe === 'clear' && selected === 'output';
  /** Why the hand cannot move the camera now, said for a moment after it tried. */
  const [heldWord, setHeldWord] = useState<string | null>(null);
  const heldTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(heldTimer.current), []);

  const facesKey = frameFontFaces(theme.style).join('|');
  useEffect(() => {
    let cancelled = false;
    void ensureFontFaces(facesKey.split('|')).then(() => !cancelled && setFontsReady((n) => n + 1));
    return () => {
      cancelled = true;
    };
  }, [facesKey]);

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
  const live = useRef({ core, viewAt, tiles, focus, size, selected });
  live.current = { core, viewAt, tiles, focus, size, selected };
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  }, [core, viewAt, tiles, focus, size, paintSeq, fontsReady, selected]);
  useEffect(() => clock.subscribe(() => (dirty.current = true)), [clock]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const starting = clock.starting;
      clock.tick(dt);
      const canvas = canvasRef.current;
      const { core: c, viewAt: v, tiles: tl, focus: fo, size: sz, selected: sel } = live.current;
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
          const held = dragging.current;
          const scene: PaintScene = { ...c, settings: held ? withPlacement(c.settings, held.piece, held.place) : c.settings, tiles: tl, focus: fo };
          painted.current = { frame: paintAtlas(ctx, scene, { t: clock.t, view: v(clock.t), width: W, height: H }), dpr };
          placeOutline(canvas, outlineRef.current, painted.current, sel);
        }
      }
      // The film moves from the end of its first frame: what that frame cost is not a jump on the next.
      if (starting) last = performance.now();
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

  /**
   * True when the story moves the camera now (a world dive, a pull-back): the
   * gesture is refused and the reason said, rather than written as a free
   * view the next frame paints over — the bounce a zoom in the dive showed.
   */
  const cameraHeld = () => {
    const held = cameraHeldBy(core.settings.intro, core.settings.outro, core.story, clock.t);
    if (!held) return false;
    setHeldWord(HELD_WORDS[held]);
    window.clearTimeout(heldTimer.current);
    heldTimer.current = window.setTimeout(() => setHeldWord(null), 1800);
    return true;
  };

  // The hand: zoom about the pointer, drag to pan — on the view shown now.
  const target: ZoomTarget = {
    scaleAt: () => viewAt(clock.t).scale,
    zoomTo: (scale, anchor) => {
      if (cameraHeld()) return;
      const r = mapOnScreen();
      if (!r) return;
      const cur = viewAt(clock.t);
      onFreeView(zoomViewAbout(cur, look, r.w, r.h, scale / cur.scale, anchor.x - r.left, anchor.y - r.top));
    },
    panBy: (dx, dy) => {
      if (cameraHeld()) return;
      const r = mapOnScreen();
      if (!r) return;
      onFreeView(panView(viewAt(clock.t), look, r.w, r.h, dx, dy));
    },
    drag: (start) => {
      if (!drawingZone) return pieceDrag(start.x, start.y) ?? 'pan';
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

  /**
   * A press on a piece of the overlay picks it up: its layer opens, and the
   * piece follows the hand — back into a spot when it comes near one — until
   * it is let go, when it is written once. Anywhere else, null: the map pans.
   */
  function pieceDrag(clientX: number, clientY: number): DragHandler | null {
    const canvas = canvasRef.current;
    const p = painted.current;
    if (!canvas || !p) return null;
    const r = canvas.getBoundingClientRect();
    const piece = pieceAt(p.frame.hits, (clientX - r.left) * p.dpr, (clientY - r.top) * p.dpr, REACH * p.dpr);
    const box = piece ? pieceBox(p.frame.hits, piece) : null;
    if (!piece || !box) return null;
    const { area, safe } = p.frame;
    const k = p.dpr;
    onPick(PIECE_LAYER[piece]);
    let moved = false;
    return {
      move: (m) => {
        moved = true;
        const place = dropPlacement({ ...box, x: box.x + m.totalX * k, y: box.y + m.totalY * k }, area, safe);
        dragging.current = { piece, place };
        dirty.current = true;
        const word = 'spot' in place ? `Back to the ${SPOT_WORDS[place.spot]}` : null;
        setSnapWord((w) => (w === word ? w : word));
      },
      end: (e) => {
        const held = dragging.current;
        dragging.current = null;
        dirty.current = true;
        setSnapWord(null);
        if (held && moved && !e.cancelled) onPlace(held.piece, held.place);
      },
    };
  }

  /** The layer under a client point: a piece of the overlay, a flight's line, else the map. */
  const layerAt = (clientX: number, clientY: number): AtlasLayer | null => {
    const canvas = canvasRef.current;
    const p = painted.current;
    if (!canvas || !p) return null;
    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.left) * p.dpr;
    const y = (clientY - r.top) * p.dpr;
    const piece = hitAt(p.frame.hits, x, y, REACH * p.dpr);
    if (piece) return piece;
    const m = p.frame.map;
    if (x < m.x || y < m.y || x > m.x + m.w || y > m.y + m.h) return null;
    // During the intro or the outro, the map is theirs.
    if (p.frame.phase !== 'flights') return p.frame.phase;
    const a = viewAffine(viewAt(clock.t), look, m.w, m.h);
    return nearFlight(core.flights, { ...a, e: a.e + m.x, f: a.f + m.y }, x, y, REACH * p.dpr) ? 'flights' : 'map';
  };

  const hand = useRef({ layerAt, onPick, drawing: drawingZone });
  hand.current = { layerAt, onPick, drawing: drawingZone };

  // A click is a press that never became a drag: it opens what it landed on.
  // A hand over a piece of the overlay is told it can be clicked.
  const press = useRef<{ x: number; y: number; id: number } | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // A second finger makes it a pinch, never a click.
    const down = (e: PointerEvent) => {
      press.current = e.button === 0 && e.isPrimary ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    };
    const cancel = () => {
      press.current = null;
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p || p.id !== e.pointerId || hand.current.drawing) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_SLOP * 2) return;
      const layer = hand.current.layerAt(e.clientX, e.clientY);
      if (layer) hand.current.onPick(layer);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const hits = !hand.current.drawing && painted.current ? painted.current.frame.hits : [];
      const at = canvasPoint(e);
      // A piece can be picked up; a word of the intro or the outro only clicked.
      el.style.cursor = pieceAt(hits, ...at) ? 'move' : hitAt(hits, ...at) ? 'pointer' : '';
    };
    const canvasPoint = (e: PointerEvent): [number, number, number] => {
      const r = canvasRef.current?.getBoundingClientRect();
      const dpr = painted.current?.dpr ?? 1;
      return r ? [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, REACH * dpr] : [-1, -1, 0];
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointercancel', cancel);
    };
  }, []);

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
      <span ref={outlineRef} aria-hidden="true" className="absolute hidden border-2 border-accent rounded-paper pointer-events-none" />
      {safeShown && size.w > 0 && <SafeZones aspect={format.aspect} width={size.w} height={size.h} />}
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
      {snapWord && (
        <span className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-on-media bg-black/60 px-3 py-1.5 rounded-full pointer-events-none">{snapWord}</span>
      )}
      {heldWord && !snapWord && (
        <span role="status" className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-on-media bg-black/60 px-3 py-1.5 rounded-full pointer-events-none">{heldWord}</span>
      )}
      {drawingZone && !band && (
        <span className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-on-media bg-black/60 px-3 py-1.5 rounded-full pointer-events-none">
          Drag a rectangle on the map — the wheel still zooms
        </span>
      )}
    </div>
  );
}

/**
 * Lay the selected layer's outline over the canvas, from the boxes the frame
 * just drew — the whole map for the map, the pieces' box for a piece of the
 * overlay, nothing for a layer the picture does not show as one thing. Set
 * on the element directly: the frame loop never renders React.
 */
function placeOutline(canvas: HTMLCanvasElement, outline: HTMLSpanElement | null, painted: { frame: PaintedFrame; dpr: number }, layer: AtlasLayer): void {
  if (!outline) return;
  const box = layer === 'map' ? painted.frame.map : unionOf(painted.frame.hits, layer);
  if (!box) {
    outline.style.display = 'none';
    return;
  }
  const pad = layer === 'map' ? -3 : 6;
  const k = 1 / painted.dpr;
  const left = `${Math.round(canvas.offsetLeft + box.x * k - pad)}px`;
  const top = `${Math.round(canvas.offsetTop + box.y * k - pad)}px`;
  const width = `${Math.round(box.w * k + 2 * pad)}px`;
  const height = `${Math.round(box.h * k + 2 * pad)}px`;
  const st = outline.style;
  if (st.display !== 'block') st.display = 'block';
  if (st.left !== left) st.left = left;
  if (st.top !== top) st.top = top;
  if (st.width !== width) st.width = width;
  if (st.height !== height) st.height = height;
}

/** The social apps' zones over the stage, hatched outside the part they leave alone. */
function SafeZones({ aspect, width, height }: { aspect: FormatSettings['aspect']; width: number; height: number }) {
  const r = safeRect(aspect, width, height);
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-accent"
    >
      <defs>
        <pattern id="atlas-safe-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="currentColor" fillOpacity="0.12" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
        </pattern>
      </defs>
      <path fillRule="evenodd" fill="url(#atlas-safe-hatch)" d={`M0 0H${width}V${height}H0Z M${r.x} ${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`} />
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 5" />
    </svg>
  );
}
