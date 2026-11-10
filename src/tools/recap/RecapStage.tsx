import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import { hitTest, type Box, type Hit, type RecapLayout } from '../../shared/recap/recap-layout';
import type { FilmPlan } from '../../shared/recap/recap-motion';
import { DEFAULT_FRAME, MAX_ZOOM, panFrame, rotateFrame, sourceRect, zoomFrame, type Frame } from '../../shared/recap/recap-frame';
import type { Drawable, PaintSources } from '../../shared/recap/recap-paint';
import { paintFilm } from '../../shared/recap/recap-opener-paint';
import type { DeviceAliases, ResolvedRecap } from '../../shared/recap/recap-slots';
import { Icons } from '../../shared/ui/icons';
import { PRESS_LOOK } from '../../shared/ui/press';
import useEditorKeys from '../../shared/ui/use-editor-keys';
import type { PlayClock } from '../../shared/media/play-clock';
import { useClockPaint } from '../../shared/media/use-play-clock';

/** What the author has in hand on the stage: a cell's slot, a text, the background. */
export type Selection = { kind: 'cell'; id: string } | { kind: 'text'; id: string } | { kind: 'background' } | null;

export function sameSelection(a: Selection, b: Selection): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === 'background' || (a as { id: string }).id === (b as { id: string }).id;
}

interface Props {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  layout: RecapLayout;
  film: FilmPlan;
  sources: PaintSources;
  page: number;
  /** The film's playhead: the stage repaints on every move of it, without a render (`performance.md`). */
  clock: PlayClock;
  /** Moves whenever a picture lands — a repaint. */
  version: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** A cell's picture dropped on another cell: the two swap. */
  onSwap: (from: string, to: string) => void;
  /** The heading dragged to another place, as a fraction of the page's width. */
  onMoveHeading: (dx: number, dy: number) => void;
  aliases: DeviceAliases;
  clipSlides: ReadonlyMap<string, number>;
  /** Instagram's buttons over a Reel, shaded where the frame is covered. */
  guides: boolean;
  /** The canvas, for a poster of the recap. */
  canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  /** What is being FRAMED on the stage (a double-click): the background or a cell's picture; null when nothing is. */
  framing: Selection;
  onFraming: (s: Selection) => void;
  /** The source a framing moves over: the clip's frame, the blurred picture, the cell's picture. */
  frameSource: (s: Selection) => Drawable | null;
  onFrame: (s: Selection, frame: Frame) => void;
  /** The film is playing: a Sheet's camera travels along it. */
  pan?: boolean;
  /** A cell's picture released outside the stage, where the pointer let go. */
  onDropOut?: (slot: string, clientX: number, clientY: number) => void;
}

const DRAG_PX = 6;

/** A key of the framing bar: a round target on the bar's ink, 34 px under a finger, that goes down when pressed. */
const BAR_KEY = `touch-row inline-flex items-center justify-center h-7 pointer-coarse:h-[2.125rem] rounded-full cursor-pointer transition-[background-color,translate] hover:bg-paper/15 data-pressed:bg-paper/30 focus-visible:outline-2 focus-visible:outline-accent ${PRESS_LOOK}`;
const BAR_GLYPH = `${BAR_KEY} w-7 pointer-coarse:w-[2.125rem] [&>svg]:w-4 [&>svg]:h-4`;

/**
 * The recap on its stage: the painter at the box's size, a click selecting
 * what it lands on (the inspector follows), a cell's picture dragged onto
 * another cell to swap them, the heading dragged to move it. The outline of
 * what is selected is drawn here, never by the painter — an export never
 * carries the editor's chrome.
 */
export default function RecapStage(props: Props) {
  const { doc, resolved, layout, film, sources, page, clock, version, selection, onSelect, onSwap, onMoveHeading, aliases, clipSlides, guides, framing, onFraming, frameSource, onFrame } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  /** The room the stage has, whatever the page's shape: the framing bar drops its words where it is tight. */
  const [roomW, setRoomW] = useState(0);
  const pageBox = layout.pages[Math.min(page, layout.pages.length - 1)];
  const aspect = pageBox ? pageBox.width / pageBox.height : 9 / 16;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      let w = r.width;
      let h = w / aspect;
      if (h > r.height) {
        h = r.height;
        w = h * aspect;
      }
      setSize({ w: Math.floor(w), h: Math.floor(h) });
      setRoomW(Math.floor(r.width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const pan = props.pan;
  const paint = (t: number) => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.w * dpr);
    const h = Math.round(size.h * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    paintFilm(g, w, doc, resolved, layout, film, sources, { t, page, aliases, clipSlides, editing: true, pan });
  };
  // What is drawn changed: one paint now. The playhead moved: one paint per move, outside React.
  useEffect(() => {
    paint(clock.t);
  }, [doc, resolved, layout, film, sources, page, version, size, aliases, clipSlides, pan, clock]);
  useClockPaint(clock, paint);

  // ---- pointer: select, drag a picture onto another cell, drag the heading ----
  const drag = useRef<{ hit: Hit; x: number; y: number; moved: boolean; pointer: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; over: string | null } | null>(null);
  const scale = pageBox && size.w ? size.w / pageBox.width : 1;
  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const hitAt = (e: { clientX: number; clientY: number }): Hit => (pageBox ? hitTest(pageBox, toPage(e).x, toPage(e).y) : { kind: 'background' });

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!canvas.current || e.button > 0) return;
    const hit = hitAt(e);
    drag.current = { hit, x: e.clientX, y: e.clientY, moved: false, pointer: e.pointerId };
    canvas.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
    d.moved = true;
    if (d.hit.kind === 'cell' && resolved.slots.find((s) => s.id === (d.hit as { id: string }).id)?.picture) {
      const over = hitAt(e);
      const r = canvas.current!.getBoundingClientRect();
      setGhost({ x: e.clientX - r.left, y: e.clientY - r.top, over: over.kind === 'cell' && over.id !== d.hit.id ? over.id : null });
    } else if (d.hit.kind === 'text' && (d.hit.id === 'heading' || d.hit.id === 'subheading')) {
      const r = canvas.current!.getBoundingClientRect();
      setGhost({ x: e.clientX - r.left, y: e.clientY - r.top, over: null });
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moved) {
      const h = d.hit;
      onSelect(h.kind === 'cell' ? { kind: 'cell', id: h.id } : h.kind === 'text' ? { kind: 'text', id: h.id } : { kind: 'background' });
      return;
    }
    if (d.hit.kind === 'cell') {
      const over = hitAt(e);
      const r = canvas.current?.getBoundingClientRect();
      const off = r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      // Dropped off the stage: perhaps onto a slide of the strip (the editor looks).
      if (off) props.onDropOut?.(d.hit.id, e.clientX, e.clientY);
      else if (over.kind === 'cell' && over.id !== d.hit.id) {
        onSwap(d.hit.id, over.id);
        onSelect({ kind: 'cell', id: over.id });
      }
    } else if (d.hit.kind === 'text' && (d.hit.id === 'heading' || d.hit.id === 'subheading') && pageBox) {
      onMoveHeading((e.clientX - d.x) / scale / pageBox.width, (e.clientY - d.y) / scale / pageBox.width);
      onSelect({ kind: 'text', id: d.hit.id });
    }
  };

  // ---- framing: a double-click on the background or a picture, then drag moves it, a wheel or a pinch zooms ----
  const frameBox: Box | null =
    framing && pageBox
      ? framing.kind === 'background'
        ? { x: 0, y: 0, w: pageBox.width, h: pageBox.height }
        : framing.kind === 'cell'
          ? (pageBox.parts.find((p) => p.kind === 'cell' && p.id === framing.id)?.box ?? null)
          : null
      : null;
  const frameNow = (): Frame =>
    (framing?.kind === 'background' ? doc.background.frame : framing?.kind === 'cell' ? resolved.slots.find((s) => s.id === framing.id)?.picture?.frame : undefined) ?? DEFAULT_FRAME;
  const frameSrc = framing ? frameSource(framing) : null;
  // A framing whose target left the page (another page, an emptied cell) ends.
  useEffect(() => {
    if (framing && !frameBox) onFraming(null);
  }, [framing, frameBox, onFraming]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ frame: Frame; x: number; y: number; dist: number } | null>(null);
  const frameDown = (e: ReactPointerEvent) => {
    if (!canvas.current) return;
    e.preventDefault();
    canvas.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { frame: frameNow(), x: cx, y: cy, dist };
  };
  const frameMove = (e: ReactPointerEvent) => {
    const g0 = gesture.current;
    if (!g0 || !pointers.current.has(e.pointerId) || !frameSrc || !frameBox) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let f = g0.frame;
    if (pts.length > 1 && g0.dist > 0) f = zoomFrame(f, (f.zoom * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g0.dist);
    onFrame(framing, panFrame(f, (cx - g0.x) / scale, (cy - g0.y) / scale, frameSrc.width, frameSrc.height, frameBox.w, frameBox.h));
  };
  const frameUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    // The finger left on the glass carries on from where the pinch stopped.
    const rest = [...pointers.current.values()];
    gesture.current = rest.length ? { frame: frameNow(), x: rest[0].x, y: rest[0].y, dist: 0 } : null;
  };
  // The wheel zooms (non-passive, so the page does not scroll under it).
  const frameRef = useRef({ framing, frameNow, onFrame });
  frameRef.current = { framing, frameNow, onFrame };
  useEffect(() => {
    const c = canvas.current;
    if (!c || !framing) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = frameRef.current;
      const f = r.frameNow();
      // Shift turns it (a tenth of a degree a notch's step), the plain wheel zooms.
      if (e.shiftKey) r.onFrame(r.framing, rotateFrame(f, (f.rotate ?? 0) + Math.sign(e.deltaY || e.deltaX) * 0.5));
      else r.onFrame(r.framing, zoomFrame(f, f.zoom * Math.exp(-e.deltaY * 0.0015)));
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [framing]);
  // The ghost: the whole picture, faint, around the window a cell shows.
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const cellFrame = framing?.kind === 'cell' ? resolved.slots.find((s) => s.id === framing.id)?.picture?.frame : undefined;
  useEffect(() => {
    const c = ghostRef.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!frameBox || framing?.kind !== 'cell' || !frameSrc) return;
    const k = scale * dpr;
    const r = sourceRect(frameSrc.width, frameSrc.height, frameBox, cellFrame);
    g.globalAlpha = 0.4;
    // Turned like the picture in its cell, around the cell's centre.
    const angle = ((cellFrame?.rotate ?? 0) * Math.PI) / 180;
    const ox = (frameBox.x + frameBox.w / 2) * k;
    const oy = (frameBox.y + frameBox.h / 2) * k;
    g.translate(ox, oy);
    g.rotate(angle);
    g.drawImage(frameSrc.image, 0, 0, frameSrc.width, frameSrc.height, r.x * k - ox, r.y * k - oy, r.w * k, r.h * k);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(frameBox.x * k, frameBox.y * k, frameBox.w * k, frameBox.h * k);
  }, [framing, frameBox?.x, frameBox?.y, frameBox?.w, frameBox?.h, frameSrc, cellFrame, size, scale, version]);
  const zoomBy = (by: number) => {
    const f = frameNow();
    onFrame(framing, zoomFrame(f, Math.min(MAX_ZOOM, f.zoom * by)));
  };
  const turnBy = (by: number) => onFrame(framing, rotateFrame(frameNow(), (frameNow().rotate ?? 0) + by));
  // The framing's own keys (the editor holds Enter and Escape): the arrows move the picture as a drag does — a
  // hundredth of its box, a twentieth with ⇧ —, + and − zoom, [ and ] turn, 0 centres.
  useEditorKeys((k) => {
    if (!framing || !frameSrc || !frameBox) return false;
    if (k.dx || k.dy) {
      const step = frameBox.w * (k.shift ? 0.05 : 0.01);
      onFrame(framing, panFrame(frameNow(), k.dx * step, k.dy * step, frameSrc.width, frameSrc.height, frameBox.w, frameBox.h));
      return true;
    }
    if (k.name !== 'char') return false;
    if (k.char === '+' || k.char === '=') zoomBy(1.15);
    else if (k.char === '-' || k.char === '_') zoomBy(1 / 1.15);
    else if (k.char === '[') turnBy(-0.5);
    else if (k.char === ']') turnBy(0.5);
    else if (k.char === '0') onFrame(framing, DEFAULT_FRAME);
    else return false;
    return true;
  }, Boolean(framing));

  // The selected part's outline, in the stage's pixels.
  let outline: Box | null = null;
  if (selection && pageBox) {
    if (selection.kind === 'background') outline = { x: 0, y: 0, w: pageBox.width, h: pageBox.height };
    else {
      const part = pageBox.parts.find((p) => (selection.kind === 'cell' ? p.kind === 'cell' : p.kind === 'text') && p.id === selection.id);
      if (part) outline = part.box;
    }
  }
  const overBox = ghost?.over && pageBox ? pageBox.parts.find((p) => p.kind === 'cell' && p.id === ghost.over)?.box : null;
  const css = (b: Box) => ({ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale });
  const story = doc.format === 'story';
  const tight = roomW > 0 && roomW < 560;

  return (
    <div
      ref={boxRef}
      // A click in the empty surround, off the page, lets go of what is in hand (his ask, 2026-11-10): the stage seen with nothing selected.
      onClick={(e) => {
        if (!framing && e.target === e.currentTarget) onSelect(null);
      }}
      className="relative w-full h-full min-h-0 flex items-center justify-center"
    >
      <div className="relative" style={{ width: size.w || undefined, height: size.h || undefined }}>
        <canvas
          ref={(el) => {
            canvas.current = el;
            if (props.canvasRef) props.canvasRef.current = el;
          }}
          role="img"
          aria-label={`${doc.title}, page ${page + 1} of ${layout.pages.length}`}
          className={`block w-full h-full touch-none select-none shadow-paper ${framing ? 'cursor-move' : 'cursor-pointer'}`}
          onPointerDown={framing ? frameDown : onPointerDown}
          onPointerMove={framing ? frameMove : onPointerMove}
          onPointerUp={framing ? frameUp : onPointerUp}
          onPointerCancel={(e) => {
            drag.current = null;
            setGhost(null);
            pointers.current.delete(e.pointerId);
            gesture.current = null;
          }}
          onDoubleClick={(e) => {
            if (framing) return;
            const h = hitAt(e);
            if (h.kind === 'cell' && resolved.slots.find((s) => s.id === h.id)?.picture) onFraming({ kind: 'cell', id: h.id });
            else if (h.kind === 'background' && (doc.background.kind === 'video' || doc.background.kind === 'blur')) onFraming({ kind: 'background' });
          }}
        />
        <canvas ref={ghostRef} aria-hidden="true" className="pointer-events-none absolute inset-0 w-full h-full" />
        {guides && story && size.h > 0 && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-[repeating-linear-gradient(135deg,rgba(217,68,42,0.10)_0_6px,transparent_6px_12px)] border-b border-dashed border-accent/50" style={{ height: size.h * 0.12 }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[repeating-linear-gradient(135deg,rgba(217,68,42,0.10)_0_6px,transparent_6px_12px)] border-t border-dashed border-accent/50" style={{ height: size.h * 0.16 }} />
          </>
        )}
        {frameBox && (
          <div className="pointer-events-none absolute border-2 border-accent" style={css(frameBox)} />
        )}
        {framing && (
          <div className="absolute left-1/2 -translate-x-1/2 top-2 z-10 flex items-center gap-0.5 px-1 py-1 rounded-full bg-ink/85 text-paper shadow-paper text-2xs font-mono whitespace-nowrap" role="toolbar" aria-label="Framing">
            {!tight && <span className="pl-2 pr-1">{framing.kind === 'background' ? 'Background' : 'Picture'} · drag to move</span>}
            <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.15)} className={BAR_GLYPH}>
              {Icons.minus}
            </button>
            <span className="tabular-nums w-10 text-center">{Math.round(frameNow().zoom * 100)} %</span>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1.15)} className={BAR_GLYPH}>
              {Icons.plus}
            </button>
            <button type="button" aria-label="Turn left" title="Turn half a degree left ([ · Shift + wheel)" onClick={() => turnBy(-0.5)} className={BAR_GLYPH}>
              {Icons.undo}
            </button>
            {!tight && <span className="tabular-nums w-11 text-center">{(frameNow().rotate ?? 0).toFixed(1)}°</span>}
            <button type="button" aria-label="Turn right" title="Turn half a degree right (] · Shift + wheel)" onClick={() => turnBy(0.5)} className={BAR_GLYPH}>
              {Icons.redo}
            </button>
            <button type="button" aria-label="Centre" title="Back to the centre, whole and level (0)" onClick={() => onFrame(framing, DEFAULT_FRAME)} className={tight ? BAR_GLYPH : `${BAR_KEY} px-2`}>
              {tight ? Icons.reset : 'Centre'}
            </button>
            <button
              type="button"
              title="Keep this framing (Enter) — Escape gives the picture back as it was"
              onClick={() => onFraming(null)}
              className={`${BAR_KEY} gap-1 px-2.5 bg-accent text-paper font-semibold hover:bg-accent data-pressed:bg-accent-ink`}
            >
              Done
              <kbd className="font-mono font-normal opacity-80 pointer-coarse:hidden">↵</kbd>
            </button>
          </div>
        )}
        {!framing && outline && (
          <div
            className={`pointer-events-none absolute border-2 ${selection?.kind === 'background' ? 'border-dashed border-accent/70' : 'border-accent'} rounded-[3px]`}
            style={{ ...css(outline), margin: -2 }}
          />
        )}
        {overBox && <div className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/10" style={css(overBox)} />}
        {ghost && <div className="pointer-events-none absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-accent shadow-paper" style={{ left: ghost.x, top: ghost.y }} />}
      </div>
    </div>
  );
}
