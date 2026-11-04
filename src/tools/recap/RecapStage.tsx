import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import { hitTest, type Box, type Hit, type RecapLayout } from '../../shared/recap/recap-layout';
import type { FilmPlan } from '../../shared/recap/recap-motion';
import { paintRecap, type PaintSources } from '../../shared/recap/recap-paint';
import type { DeviceAliases, ResolvedRecap } from '../../shared/recap/recap-slots';

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
  t: number;
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
}

const DRAG_PX = 6;

/**
 * The recap on its stage: the painter at the box's size, a click selecting
 * what it lands on (the inspector follows), a cell's picture dragged onto
 * another cell to swap them, the heading dragged to move it. The outline of
 * what is selected is drawn here, never by the painter — an export never
 * carries the editor's chrome.
 */
export default function RecapStage(props: Props) {
  const { doc, resolved, layout, film, sources, page, t, version, selection, onSelect, onSwap, onMoveHeading, aliases, clipSlides, guides } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
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
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
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
    paintRecap(g, w, doc, resolved, layout, film, sources, { t, page, aliases, clipSlides, editing: true });
  }, [doc, resolved, layout, film, sources, page, t, version, size, aliases, clipSlides]);

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
    } else if (d.hit.kind === 'text' && (d.hit.role === 'heading' || d.hit.role === 'subheading')) {
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
      if (over.kind === 'cell' && over.id !== d.hit.id) {
        onSwap(d.hit.id, over.id);
        onSelect({ kind: 'cell', id: over.id });
      }
    } else if (d.hit.kind === 'text' && (d.hit.role === 'heading' || d.hit.role === 'subheading') && pageBox) {
      onMoveHeading((e.clientX - d.x) / scale / pageBox.width, (e.clientY - d.y) / scale / pageBox.width);
      onSelect({ kind: 'text', id: d.hit.id });
    }
  };

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

  return (
    <div ref={boxRef} className="relative w-full h-full min-h-0 flex items-center justify-center">
      <div className="relative" style={{ width: size.w || undefined, height: size.h || undefined }}>
        <canvas
          ref={(el) => {
            canvas.current = el;
            if (props.canvasRef) props.canvasRef.current = el;
          }}
          role="img"
          aria-label={`${doc.title}, page ${page + 1} of ${layout.pages.length}`}
          className="block w-full h-full touch-none select-none cursor-pointer shadow-paper"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setGhost(null);
          }}
        />
        {guides && story && size.h > 0 && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-[repeating-linear-gradient(135deg,rgba(217,68,42,0.10)_0_6px,transparent_6px_12px)] border-b border-dashed border-accent/50" style={{ height: size.h * 0.12 }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[repeating-linear-gradient(135deg,rgba(217,68,42,0.10)_0_6px,transparent_6px_12px)] border-t border-dashed border-accent/50" style={{ height: size.h * 0.16 }} />
          </>
        )}
        {outline && (
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
