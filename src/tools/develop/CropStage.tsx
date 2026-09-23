import { useEffect, useRef, useState } from 'react';
import { describeAspect, type CropHandle } from '../../shared/develop/crop-aspect';
import {
  clampToward,
  drawCandidate,
  moveZone,
  pointOnPicture,
  resizeZone,
  turnedCorners,
  zoneInSourcePixels,
  zoneValid,
  type CropZone,
  type PictureDims,
} from '../../shared/develop/crop-rect';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import { useZoomGestures } from '../../shared/ui/use-zoom-gestures';
import { cropStageTransform, zoomCropViewAbout, type CropView } from './crop-view';
import type { CropZoneApi } from './use-crop-zone';

/** The dark laid over what the crop cuts away — the prototype's, measured against paper and black. */
const VEIL = 'rgba(10, 9, 8, 0.66)';
/** How far a pointer travels on the veil before it is drawing a zone, not clicking. */
const DRAW_START_PX = 6;

const HANDLE_CURSOR: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

type Gesture =
  | { kind: 'resize'; id: number; handle: CropHandle; start: CropZone; grabX: number; grabY: number }
  | { kind: 'move'; id: number; lastX: number; lastY: number }
  | { kind: 'level'; id: number; x1: number; y1: number }
  | { kind: 'draw'; id: number; anchor: { x: number; y: number }; startX: number; startY: number; drawing: boolean; drew: boolean };

/**
 * The stage's fit and the inspection view over it, from `crop-view.ts`: the
 * quarter-turned picture in the box, fitted ONCE — a fine angle never refits
 * it — then the zoom and pan, which only a pinch, the wheel, the pill or `Z`
 * move, and which the hook already holds inside the stage.
 */
function viewFor(box: { w: number; h: number }, src: PictureDims, rotation: number, view: CropView) {
  return cropStageTransform(box, src, rotation, view);
}

/** Which handle a point (CSS px) is on, corners before edges; `tol` is the hit radius. */
function handleAt(z: { l: number; t: number; r: number; b: number }, x: number, y: number, tol: number): CropHandle | null {
  const nearL = Math.abs(x - z.l) <= tol;
  const nearR = Math.abs(x - z.r) <= tol;
  const nearT = Math.abs(y - z.t) <= tol;
  const nearB = Math.abs(y - z.b) <= tol;
  if (nearT && nearL) return 'nw';
  if (nearT && nearR) return 'ne';
  if (nearB && nearL) return 'sw';
  if (nearB && nearR) return 'se';
  const inX = x > z.l && x < z.r;
  const inY = y > z.t && y < z.b;
  if (nearT && inX) return 'n';
  if (nearB && inX) return 's';
  if (nearL && inY) return 'w';
  if (nearR && inY) return 'e';
  return null;
}

/**
 * The Develop tool's crop stage — the classic crop the maintainer asked for
 * (2026-09-19, `develop-roll.md`): the WHOLE picture as delivered, fitted once
 * and never moving while it is cropped, with the kept zone drawn over it and
 * everything outside under a veil. The zone is edited here and stored as the
 * aspect + framing the roll always stored (`crop-rect.ts`), so the export, the
 * filmstrip cell and the Develop viewport are unchanged.
 *
 * Gestures: inside the zone moves it (sliding along the picture's edge), on
 * the veil draws a new one from that point, the eight handles are anchored on
 * the opposite edge or corner (Shift locks the ratio in Free), a double-click
 * takes the largest zone of the format, and the arrows nudge it while the
 * stage has focus (Shift ×10) — which is why the stage takes focus on a press:
 * unfocused, the arrows still step along the roll.
 *
 * One canvas draws everything (picture, veil, outline, thirds, handles): the
 * zone moves every pointer frame, and DOM handles would be one more layout to
 * keep in step with it. Only the size tag is a DOM element.
 */
export default function CropStage({
  picture,
  crop,
  sourceSize,
  emptyText,
  className,
}: {
  picture: DevelopPicture;
  crop: CropZoneApi;
  /** The FILE's own pixel size, when measured — what the tag says. */
  sourceSize: PictureDims | null;
  emptyText: string;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [active, setActive] = useState(false);
  // The Level tool's line while it is drawn, in the zone's frame.
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const { source, cube, delivered } = picture;
  const hasSource = source !== null;
  const { src, zone, framing, rotating, levelling, setStageBox } = crop;

  // The stage's own size, measured — the canvas fills it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const next = r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : null;
      setBox(next);
      // The hook clamps every write of the view to this box.
      setStageBox(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => {
      observer.disconnect();
      setStageBox(null);
    };
  }, [hasSource, setStageBox]);

  // --- paint ------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box || !src || !zone) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(box.w * dpr);
    const bh = Math.round(box.h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const { k, ox, oy } = viewFor(box, src, framing.rotation, crop.view);
    const image = delivered();
    const angle = (framing.rotation * Math.PI) / 180;
    if (image) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(k, k);
      ctx.rotate(angle);
      ctx.scale(framing.flipX ? -1 : 1, framing.flipY ? -1 : 1);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, -src.width / 2, -src.height / 2, src.width, src.height);
      ctx.restore();
    }
    const l = ox + k * (zone.cx - zone.w / 2);
    const t = oy + k * (zone.cy - zone.h / 2);
    const w = k * zone.w;
    const h = k * zone.h;
    // The veil: the whole stage less the zone, one even-odd path.
    ctx.beginPath();
    ctx.rect(0, 0, box.w, box.h);
    ctx.rect(l, t, w, h);
    ctx.fillStyle = VEIL;
    ctx.fill('evenodd');
    // The turned picture's outline, faint and dashed: what is available.
    const corners = turnedCorners(framing.rotation, src);
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(ox + k * p.x, oy + k * p.y) : ctx.moveTo(ox + k * p.x, oy + k * p.y)));
    ctx.closePath();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.stroke();
    ctx.setLineDash([]);
    // Thirds inside the zone, stronger while a gesture is on.
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(l + w * f, t);
      ctx.lineTo(l + w * f, t + h);
      ctx.moveTo(l, t + h * f);
      ctx.lineTo(l + w, t + h * f);
    }
    ctx.strokeStyle = active ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();
    // While the angle moves, a dense grid: straightening is judged against
    // lines, and thirds are too few to read a horizon by.
    if (rotating) {
      const cell = Math.max(14, Math.min(w, h) / 12);
      ctx.beginPath();
      for (let x = l + cell; x < l + w - 1; x += cell) {
        ctx.moveTo(x, t);
        ctx.lineTo(x, t + h);
      }
      for (let y = t + cell; y < t + h - 1; y += cell) {
        ctx.moveTo(l, y);
        ctx.lineTo(l + w, y);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.stroke();
    }
    // The zone's edge.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeRect(l + 0.5, t + 0.5, w - 1, h - 1);
    // Handles: brackets at the corners, bars mid-edge, drawn just inside.
    ctx.fillStyle = '#ffffff';
    const arm = Math.min(18, w / 3, h / 3);
    const thick = 3;
    for (const [x, y, sx, sy] of [
      [l, t, 1, 1],
      [l + w, t, -1, 1],
      [l, t + h, 1, -1],
      [l + w, t + h, -1, -1],
    ] as const) {
      ctx.fillRect(sx > 0 ? x - thick : x - arm, sy > 0 ? y - thick : y, arm + thick, thick);
      ctx.fillRect(sx > 0 ? x - thick : x, sy > 0 ? y - thick : y - arm, thick, arm + thick);
    }
    const bar = Math.min(22, w / 4, h / 4);
    ctx.fillRect(l + w / 2 - bar / 2, t - thick, bar, thick);
    ctx.fillRect(l + w / 2 - bar / 2, t + h, bar, thick);
    ctx.fillRect(l - thick, t + h / 2 - bar / 2, thick, bar);
    ctx.fillRect(l + w, t + h / 2 - bar / 2, thick, bar);
    // The Level line, drawn over everything while it is being laid.
    if (line) {
      ctx.beginPath();
      ctx.moveTo(ox + k * line.x1, oy + k * line.y1);
      ctx.lineTo(ox + k * line.x2, oy + k * line.y2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#d9442a';
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }, [box, src, zone, framing, source, cube, delivered, active, rotating, line, crop.view]);

  // --- gestures -----------------------------------------------------------------
  const live = useRef({ crop, box });
  live.current = { crop, box };
  // Two fingers are on the stage: the zone's own pointers stand down.
  const pinching = useRef(false);
  // The zone's gesture in flight, cleared by a takeover — declared here so
  // the shared machine can reach it.
  const gestureRef = useRef<Gesture | null>(null);
  const currentRef = useRef<CropZone | null>(null);

  /** A client point as stage px from its top-left corner. */
  const local = (clientX: number, clientY: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left, y: clientY - r.top } : { x: clientX, y: clientY };
  };

  // The wheel, a trackpad pinch and two fingers zoom the VIEW about the
  // pointer or the fingers' live centre — the suite's one reading of the hand
  // (`use-zoom-gestures.ts`), heard on the STAGE with `touch-none` and the
  // browser's own pinch refused there. A single pointer is never the
  // machine's here: it is the zone's, below.
  useZoomGestures({
    ref: stageRef,
    active: hasSource,
    target: {
      scaleAt: () => live.current.crop.view.zoom,
      zoomTo: (zoom, anchor) => {
        const { crop: c, box: b } = live.current;
        if (!b || !c.src) return;
        const p = local(anchor.x, anchor.y);
        c.setView((v) => zoomCropViewAbout(v, zoom, p, b, c.src!, c.framing.rotation));
      },
      panBy: (dx, dy) => live.current.crop.setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })),
      drag: () => null,
      onTakeover: () => {
        // The second finger turns whatever the first began into a pinch —
        // the zone keeps what that finger already did, and stops there.
        gestureRef.current = null;
        currentRef.current = null;
        setActive(false);
        setLine(null);
      },
      onPinch: (on) => {
        pinching.current = on;
      },
    },
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const geometry = () => {
      const { crop: c, box: b } = live.current;
      if (!c.src || !c.zone || !b) return null;
      const v = viewFor(b, c.src, c.framing.rotation, c.view);
      return { c, v, src: c.src, deg: c.framing.rotation };
    };
    const edges = (z: CropZone, v: { k: number; ox: number; oy: number }) => ({
      l: v.ox + v.k * (z.cx - z.w / 2),
      r: v.ox + v.k * (z.cx + z.w / 2),
      t: v.oy + v.k * (z.cy - z.h / 2),
      b: v.oy + v.k * (z.cy + z.h / 2),
    });

    const onDown = (e: PointerEvent) => {
      const g = geometry();
      if (!g) return;
      if (e.pointerType !== 'touch' && e.button !== 0) return;
      // A second finger is the machine's pinch, never a zone gesture; the one
      // left after a pinch starts nothing either.
      if (pinching.current) return;
      stage.focus({ preventScroll: true });
      const p = local(e.clientX, e.clientY);
      const zone = g.c.zone!;
      const tol = e.pointerType === 'touch' ? 22 : 10;
      const handle = handleAt(edges(zone, g.v), p.x, p.y, tol);
      const zx = (p.x - g.v.ox) / g.v.k;
      const zy = (p.y - g.v.oy) / g.v.k;
      currentRef.current = zone;
      let gesture: Gesture;
      if (g.c.levelling) {
        gesture = { kind: 'level', id: e.pointerId, x1: zx, y1: zy };
      } else if (handle) {
        // Where the finger took the handle, from the edge itself: a finger
        // lands up to 22px off it, and the edge must not jump under it.
        const edgeX = handle.includes('e') ? zone.cx + zone.w / 2 : handle.includes('w') ? zone.cx - zone.w / 2 : zx;
        const edgeY = handle.includes('s') ? zone.cy + zone.h / 2 : handle.includes('n') ? zone.cy - zone.h / 2 : zy;
        gesture = { kind: 'resize', id: e.pointerId, handle, start: zone, grabX: edgeX - zx, grabY: edgeY - zy };
      } else if (
        zx > zone.cx - zone.w / 2 &&
        zx < zone.cx + zone.w / 2 &&
        zy > zone.cy - zone.h / 2 &&
        zy < zone.cy + zone.h / 2
      ) {
        gesture = { kind: 'move', id: e.pointerId, lastX: zx, lastY: zy };
      } else if (pointOnPicture(zx, zy, g.deg, g.src)) {
        gesture = { kind: 'draw', id: e.pointerId, anchor: { x: zx, y: zy }, startX: p.x, startY: p.y, drawing: false, drew: false };
      } else {
        return;
      }
      gestureRef.current = gesture;
      e.preventDefault();
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        /* not a live pointer */
      }
      if (gesture.kind !== 'draw') setActive(true);
    };

    const onMove = (e: PointerEvent) => {
      const g = geometry();
      if (!g) return;
      if (pinching.current) return;
      const p = local(e.clientX, e.clientY);
      const gesture = gestureRef.current;
      const current = currentRef.current;
      if (!gesture) {
        // Hover: the cursor says what a press would do.
        if (e.pointerType === 'touch') return;
        if (g.c.levelling) {
          stage.style.cursor = 'crosshair';
          return;
        }
        const zone = g.c.zone!;
        const handle = handleAt(edges(zone, g.v), p.x, p.y, 10);
        const e2 = edges(zone, g.v);
        const inside = p.x > e2.l && p.x < e2.r && p.y > e2.t && p.y < e2.b;
        stage.style.cursor = handle ? HANDLE_CURSOR[handle] : inside ? 'move' : 'crosshair';
        return;
      }
      if (e.pointerId !== gesture.id || !current) return;
      e.preventDefault();
      const zx = (p.x - g.v.ox) / g.v.k;
      const zy = (p.y - g.v.oy) / g.v.k;
      // In Free, Shift holds the ratio the gesture started with.
      const freeLock = (z: CropZone) => (e.shiftKey ? z.w / z.h : null);
      let next: CropZone | null = null;
      if (gesture.kind === 'level') {
        setLine({ x1: gesture.x1, y1: gesture.y1, x2: zx, y2: zy });
        return;
      }
      if (gesture.kind === 'resize') {
        const lock = g.c.lock ?? freeLock(gesture.start);
        next = resizeZone(gesture.start, current, gesture.handle, zx + gesture.grabX, zy + gesture.grabY, lock, g.deg, g.src);
      } else if (gesture.kind === 'move') {
        next = moveZone(current, zx - gesture.lastX, zy - gesture.lastY, g.deg, g.src);
        // The pointer's own position, not the zone's: a move held at an edge
        // resumes the moment the pointer comes back, not a lag later.
        gesture.lastX = zx;
        gesture.lastY = zy;
      } else {
        if (!gesture.drawing) {
          if (Math.hypot(p.x - gesture.startX, p.y - gesture.startY) < DRAW_START_PX) return;
          gesture.drawing = true;
          setActive(true);
        }
        const lock = g.c.lock ?? (e.shiftKey ? current.w / current.h : null);
        const candidate = drawCandidate(gesture.anchor, zx, zy, lock, g.deg, g.src);
        if (zoneValid(candidate, g.deg, g.src)) {
          next = candidate;
          gesture.drew = true;
        } else if (gesture.drew) {
          // Clamped from the last zone THIS draw made — never from the zone
          // it is replacing, which would morph the old one toward the pointer.
          next = clampToward(current, candidate, g.deg, g.src);
        }
      }
      if (next && next !== current) {
        // The zone as THIS gesture last wrote it: a render may lag a pointer
        // frame, and two moves in one frame must compose, not both start
        // from the render.
        currentRef.current = next;
        g.c.setZone(next);
      }
    };

    const onUp = (e: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || e.pointerId !== gesture.id) return;
      if (gesture.kind === 'level' && e.type === 'pointerup') {
        const g = geometry();
        const p = local(e.clientX, e.clientY);
        if (g) {
          const x2 = (p.x - g.v.ox) / g.v.k;
          const y2 = (p.y - g.v.oy) / g.v.k;
          // A click is not a line: under a few pixels the tool stays armed.
          if (Math.hypot(x2 - gesture.x1, y2 - gesture.y1) * g.v.k >= 12) g.c.level(gesture.x1, gesture.y1, x2, y2);
        }
        setLine(null);
      } else if (gesture.kind === 'level') {
        setLine(null);
      }
      gestureRef.current = null;
      currentRef.current = null;
      setActive(false);
    };

    const onDouble = (e: MouseEvent) => {
      if (!geometry()) return;
      e.preventDefault();
      live.current.crop.maximize();
    };

    const onKey = (e: KeyboardEvent) => {
      const g = geometry();
      if (!g || e.metaKey || e.ctrlKey || e.altKey) return;
      const step = (e.shiftKey ? 10 : 1) / g.v.k;
      const d =
        e.key === 'ArrowLeft'
          ? [-step, 0]
          : e.key === 'ArrowRight'
            ? [step, 0]
            : e.key === 'ArrowUp'
              ? [0, -step]
              : e.key === 'ArrowDown'
                ? [0, step]
                : null;
      if (!d) return;
      // Claimed: the editor's window handler steps pictures on an arrow.
      e.preventDefault();
      g.c.setZone(moveZone(g.c.zone!, d[0], d[1], g.deg, g.src));
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('dblclick', onDouble);
    stage.addEventListener('keydown', onKey);
    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('dblclick', onDouble);
      stage.removeEventListener('keydown', onKey);
    };
  }, [hasSource]);

  // The size tag, in the FILE's pixels, while a gesture is on.
  let tag: { x: number; y: number; text: string } | null = null;
  if (active && box && src && zone) {
    const v = viewFor(box, src, framing.rotation, crop.view);
    const px = zoneInSourcePixels(zone, src, sourceSize);
    const top = v.oy + v.k * (zone.cy - zone.h / 2);
    tag = {
      x: v.ox + v.k * (zone.cx - zone.w / 2),
      y: top > 30 ? top - 26 : top + 6,
      text: `${px.w} × ${px.h} px · ${describeAspect(zone.w / zone.h)}`,
    };
  }

  return (
    // `touch-none`: every gesture here writes both axes inside a fixed-height
    // stage, which is not a scroll box (`frontend.md`). Focusable, so the
    // arrows nudge the zone once it has been touched — and only then.
    <div
      ref={stageRef}
      tabIndex={hasSource ? 0 : -1}
      aria-label="Crop: drag inside the zone to move it, on the picture to draw a new one, the handles to resize; the arrows nudge it"
      className={`relative overflow-hidden touch-none select-none rounded-paper bg-frame outline-none focus-visible:ring-2 focus-visible:ring-accent ${className ?? ''}`}
    >
      {hasSource ? (
        <>
          <canvas ref={canvasRef} aria-hidden className="absolute inset-0 w-full h-full" />
          {levelling && !line && (
            <span className="absolute left-1/2 top-3 -translate-x-1/2 pointer-events-none rounded-sm bg-frame/80 px-2 py-1 font-mono text-2xs text-on-media whitespace-nowrap">
              draw a line along the horizon, or along an upright
            </span>
          )}
          {tag && (
            <span
              className="absolute pointer-events-none rounded-sm bg-frame/80 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-on-media whitespace-nowrap"
              style={{ left: tag.x, top: tag.y }}
            >
              {tag.text}
            </span>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <p className="m-0 max-w-xs text-center text-sm text-muted">{emptyText}</p>
        </div>
      )}
    </div>
  );
}
