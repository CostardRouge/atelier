/**
 * ONE reading of the hand for every surface that zooms and moves a picture —
 * the wheel, a trackpad pinch (which arrives as a ⌘/ctrl-wheel), two fingers,
 * one pointer dragging — with no opinion about what it moves.
 *
 * The suite has two USES for the same gestures, and they must stay two:
 *
 *  - **Looking** — a view zoom that writes nothing (the develop viewport, the
 *    crop stage, the lightbox): a transform over the preview, gone when the
 *    picture is fitted again.
 *  - **Placing** — a FRAMING that writes the document (Trips' badge stage):
 *    the picture moved and enlarged inside its frame, cropped against its
 *    edges, exported as such. No view zoom there, on the maintainer's call.
 *
 * What made them disagree was that each surface read the hand itself — four
 * pinch machines, four wheel curves, one of them anchoring nowhere and one
 * anchoring where the pinch BEGAN. So the reading lives here, once, and a
 * surface only says what a scale is under a point, what to do with a new
 * scale, and what to do with a pixel delta (`ZoomTarget`). The DOM half is
 * `use-zoom-gestures.ts`; this half takes plain records and is tested.
 *
 * Grammar, the same on every surface:
 *  - ⌘/ctrl-wheel zooms about the pointer. A bare VERTICAL wheel zooms too
 *    under `wheel: 'any'` (a surface with nothing else to do with it), and is
 *    left to the page under `'modifier'`. A shift-wheel or a sideways trackpad
 *    sweep is a horizontal pan while there is somewhere to go.
 *  - Two fingers pinch AND pan by their LIVE centre, the pan applied first so
 *    the zoom's anchor correction is measured from an offset already moved.
 *    The ratio is measured from the spread the pinch began with, never
 *    compounded frame by frame (that drifts under the hand).
 *  - The second finger of a pinch TAKES OVER whatever the first was doing —
 *    the surface is told (`onTakeover`) and must let go.
 *  - One finger of a pinch lifting hands the pan to the finger left, rather
 *    than leaving it inert until it is put down again.
 *  - One pointer is offered to the surface as a DRAG (`drag`): it may pan it
 *    (`'pan'`), read it itself (a swipe, a wipe), or refuse it. A finger over
 *    a control still COUNTS for the pinch, but never starts a drag.
 */

import { wheelZoomFactor, type Point } from './pan-zoom';
import { wheelZooms, type WheelZoom } from './stage-zoom';

/** Pixels a pointer travels before its press is a drag and not a tap. */
export const DRAG_SLOP = 3;

export type PointerKind = 'mouse' | 'pen' | 'touch';

/** A pointer event, stripped to what the reading needs. */
export interface GesturePointer {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
  /** Mouse button, 0 for the primary; ignored for a touch. */
  button: number;
  /** Over a button or a `[data-pan-ignore]`: counted for a pinch, never dragged. */
  overControl: boolean;
  /** What the pointer landed on, for a surface that claims by element. */
  target: EventTarget | null;
  /** Event time, ms — what the drag's speed is measured against. */
  t: number;
}

export interface GestureWheel extends Point {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type ZoomBy = 'wheel' | 'pinch';
export type PanBy = 'drag' | 'pinch' | 'wheel';

export interface DragStart extends Point {
  /** The pointer, or null for a finger left over from a pinch that has not moved yet. */
  pointer: GesturePointer | null;
  handoff: boolean;
}

export interface DragMove extends Point {
  dx: number;
  dy: number;
  totalX: number;
  totalY: number;
  /** px per ms along x, from the last two samples. */
  speedX: number;
  pointer: GesturePointer;
}

export interface DragEnd {
  totalX: number;
  totalY: number;
  speedX: number;
  /** Ended by a second finger or by the browser, not by a lift. */
  cancelled: boolean;
}

/** A surface reading a drag itself. */
export interface DragHandler {
  move(m: DragMove): void;
  end(e: DragEnd): void;
}

/**
 * What a surface answers with. Every point is in the coordinates the surface
 * was given (client pixels from the hook); the surface converts.
 */
export interface ZoomTarget {
  /** The scale under `at` right now — a view's, or the framing's of the cell under it. */
  scaleAt(at: Point): number;
  /** Take `scale` while keeping `anchor` still. The target clamps to its own ceiling. */
  zoomTo(scale: number, anchor: Point, by: ZoomBy): void;
  /** Move by a pixel delta; `at` is where the hand is (which cell, for a collage). */
  panBy(dx: number, dy: number, at: Point, by: PanBy): void;
  /**
   * One pointer landing free. `'pan'` lets the machine pan it through `panBy`
   * past the slop; a handler reads it itself; null leaves it to whoever else
   * listens. Not asked for the second finger of a pinch, nor over a control.
   */
  drag?(start: DragStart): 'pan' | DragHandler | null;
  /** A second finger turned the surface's own gesture into a pinch: let go. */
  onTakeover?(): void;
  /** Two fingers are on the surface (true), or the last of them lifted (false). */
  onPinch?(active: boolean): void;
  /** A gesture began — a press or a wheel notch (a button's easing stops). */
  onGesture?(): void;
  /** The machine started or ended dragging a pointer it was given. */
  onDragging?(active: boolean): void;
  /** Capture this pointer on the element (a mouse leaving mid-drag still reports). */
  capture?(id: number): void;
}

export interface ZoomGestureOptions {
  /** What a bare wheel does; `'none'` leaves the wheel entirely to the surface. */
  wheel?: WheelZoom | 'none';
  slop?: number;
}

interface Drag {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  speedX: number;
  moving: boolean;
  mode: 'pan' | DragHandler;
}

interface Pinch {
  spread: number;
  scale: number;
}

/**
 * The reading itself. Feed it pointer and wheel records; it answers through
 * the target. One per surface, for the life of its element.
 */
export class ZoomGestureMachine {
  private readonly touches = new Map<number, Point & { t: number }>();
  private pinch: Pinch | null = null;
  private drag: Drag | null = null;
  private readonly wheel: WheelZoom | 'none';
  private readonly slop: number;

  constructor(
    private readonly target: ZoomTarget,
    { wheel = 'any', slop = DRAG_SLOP }: ZoomGestureOptions = {},
  ) {
    this.wheel = wheel;
    this.slop = slop;
  }

  /** Two fingers are on the surface. */
  get pinching(): boolean {
    return this.pinch !== null;
  }

  /** The machine is dragging a pointer it was given. */
  get dragging(): boolean {
    return this.drag !== null && this.drag.moving;
  }

  /** Whether the wheel event was consumed (the caller prevents its default). */
  onWheel(e: GestureWheel): boolean {
    if (this.wheel === 'none') return false;
    const zooms = wheelZooms(e, this.wheel);
    // Under `modifier` a bare wheel is the page's: nothing here reads it.
    if (!zooms && this.wheel === 'modifier') return false;
    this.target.onGesture?.();
    const at = { x: e.x, y: e.y };
    if (zooms) {
      this.target.zoomTo(this.target.scaleAt(at) * wheelZoomFactor(e.deltaY), at, 'wheel');
    } else {
      // A sideways sweep, or a shift-wheel the browser already turned sideways.
      this.target.panBy(-e.deltaX, -e.deltaY, at, 'wheel');
    }
    return true;
  }

  onDown(p: GesturePointer): void {
    if (p.kind === 'touch') {
      this.touches.set(p.id, { x: p.x, y: p.y, t: p.t });
      if (this.touches.size === 2) {
        this.target.onGesture?.();
        // The second finger makes a pinch of the two, whatever the first was
        // doing — the machine's own drag, or the surface's.
        this.endDrag(true);
        this.pinch = { spread: this.spread(), scale: this.target.scaleAt(this.centre()) };
        this.target.onTakeover?.();
        this.target.onPinch?.(true);
        return;
      }
      if (this.touches.size > 2) return;
    } else if (p.button !== 0) {
      return;
    }
    this.target.onGesture?.();
    // A control keeps its own press; its finger was still counted above.
    if (p.overControl || this.pinch) return;
    this.begin({ x: p.x, y: p.y, pointer: p, handoff: false }, p.id, p.t, p.kind);
  }

  onMove(p: GesturePointer): boolean {
    if (p.kind === 'touch' && this.touches.has(p.id)) {
      const before = this.touches.size === 2 ? this.centre() : null;
      this.touches.set(p.id, { x: p.x, y: p.y, t: p.t });
      if (this.pinch && before && this.touches.size === 2) {
        const after = this.centre();
        // Pan on the fingers' centre first, so the zoom's own correction is
        // measured from an offset already moved.
        this.target.panBy(after.x - before.x, after.y - before.y, after, 'pinch');
        if (this.pinch.spread > 0) {
          this.target.zoomTo(this.pinch.scale * (this.spread() / this.pinch.spread), after, 'pinch');
        }
        return true;
      }
    }
    const d = this.drag;
    if (!d || p.id !== d.id) return false;
    if (!d.moving) {
      if (Math.hypot(p.x - d.startX, p.y - d.startY) < this.slop) {
        // Not a drag yet — but the last position moves with the pointer, or
        // the first real step would carry the whole slop as a jump.
        d.lastX = p.x;
        d.lastY = p.y;
        d.lastT = p.t;
        return false;
      }
      d.moving = true;
      if (d.mode === 'pan') this.target.onDragging?.(true);
    }
    const dx = p.x - d.lastX;
    const dy = p.y - d.lastY;
    const dt = p.t - d.lastT;
    if (dt > 0) d.speedX = dx / dt;
    d.lastX = p.x;
    d.lastY = p.y;
    d.lastT = p.t;
    const move: DragMove = {
      x: p.x,
      y: p.y,
      dx,
      dy,
      totalX: p.x - d.startX,
      totalY: p.y - d.startY,
      speedX: d.speedX,
      pointer: p,
    };
    if (d.mode === 'pan') this.target.panBy(dx, dy, move, 'drag');
    else d.mode.move(move);
    return true;
  }

  /** A lift, or a cancel (`cancelled`) the browser decided. */
  onUp(p: GesturePointer, cancelled = false): void {
    if (p.kind === 'touch') {
      this.touches.delete(p.id);
      if (this.pinch && this.touches.size < 2) {
        this.pinch = null;
        this.target.onPinch?.(false);
        // One finger of the pinch lifted, the other still down: it takes the
        // pan over rather than being inert until lifted and put back. Zoomed
        // in, that second half is most of the gesture.
        const [id] = [...this.touches.keys()];
        const at = id === undefined ? undefined : this.touches.get(id);
        if (id !== undefined && at) {
          this.begin({ x: at.x, y: at.y, pointer: null, handoff: true }, id, at.t, 'touch');
          if (this.drag) this.drag.moving = true;
          if (this.drag?.mode === 'pan') this.target.onDragging?.(true);
        }
      }
    }
    if (this.drag && p.id === this.drag.id) this.endDrag(cancelled);
  }

  private begin(start: DragStart, id: number, t: number, kind: PointerKind): void {
    const mode = this.target.drag?.(start) ?? null;
    if (!mode) return;
    this.drag = {
      id,
      startX: start.x,
      startY: start.y,
      lastX: start.x,
      lastY: start.y,
      lastT: t,
      speedX: 0,
      moving: false,
      mode,
    };
    // A touch is captured by the browser already; a mouse leaving the frame
    // mid-drag is not, and must still report.
    if (kind !== 'touch') this.target.capture?.(id);
  }

  private endDrag(cancelled: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.mode === 'pan') {
      if (d.moving) this.target.onDragging?.(false);
      return;
    }
    d.mode.end({
      totalX: d.lastX - d.startX,
      totalY: d.lastY - d.startY,
      speedX: d.speedX,
      cancelled,
    });
  }

  private centre(): Point {
    const pts = [...this.touches.values()];
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }

  private spread(): number {
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
