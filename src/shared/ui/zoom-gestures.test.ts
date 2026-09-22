/**
 * The one reading of the hand, driven by plain records: what the four
 * surfaces used to each get subtly wrong — where a pinch anchors, who owns
 * the first finger once a second lands, what the finger left after a pinch
 * does — is pinned here rather than re-learned per surface.
 */

import { describe, expect, it } from 'vitest';
import {
  DRAG_SLOP,
  ZoomGestureMachine,
  type DragHandler,
  type DragStart,
  type GesturePointer,
  type GestureWheel,
  type ZoomTarget,
} from './zoom-gestures';
import { wheelZoomFactor } from './pan-zoom';

type Call =
  | ['zoom', number, number, number, string]
  | ['pan', number, number, number, number, string]
  | ['takeover']
  | ['gesture']
  | ['dragging', boolean]
  | ['capture', number];

function harness(
  overrides: Partial<ZoomTarget> & { scale?: number } = {},
): { target: ZoomTarget; calls: Call[]; only: (kind: Call[0]) => Call[] } {
  const calls: Call[] = [];
  const target: ZoomTarget = {
    scaleAt: () => overrides.scale ?? 2,
    zoomTo: (s, a, by) => calls.push(['zoom', s, a.x, a.y, by]),
    panBy: (dx, dy, at, by) => calls.push(['pan', dx, dy, at.x, at.y, by]),
    onTakeover: () => calls.push(['takeover']),
    onGesture: () => calls.push(['gesture']),
    onDragging: (on) => calls.push(['dragging', on]),
    capture: (id) => calls.push(['capture', id]),
    ...overrides,
  };
  return { target, calls, only: (kind) => calls.filter((c) => c[0] === kind) };
}

const touch = (id: number, x: number, y: number, t = 0): GesturePointer => ({
  id,
  kind: 'touch',
  x,
  y,
  button: 0,
  overControl: false,
  target: null,
  t,
});
const mouse = (x: number, y: number, t = 0, extra: Partial<GesturePointer> = {}): GesturePointer => ({
  id: 1,
  kind: 'mouse',
  x,
  y,
  button: 0,
  overControl: false,
  target: null,
  t,
  ...extra,
});
const wheel = (deltaX: number, deltaY: number, extra: Partial<GestureWheel> = {}): GestureWheel => ({
  x: 100,
  y: 80,
  deltaX,
  deltaY,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...extra,
});

describe('the wheel', () => {
  it('zooms about the pointer on a vertical notch, by the one curve', () => {
    const h = harness();
    const m = new ZoomGestureMachine(h.target);
    expect(m.onWheel(wheel(0, -100))).toBe(true);
    expect(h.only('zoom')).toEqual([['zoom', 2 * wheelZoomFactor(-100), 100, 80, 'wheel']]);
  });

  it('zooms on a ⌘/ctrl-wheel whatever its axis — a trackpad pinch', () => {
    const h = harness();
    const m = new ZoomGestureMachine(h.target);
    m.onWheel(wheel(30, -10, { ctrlKey: true }));
    expect(h.only('zoom')).toHaveLength(1);
    expect(h.only('pan')).toHaveLength(0);
  });

  it('pans on a sideways sweep, consumed either way', () => {
    const h = harness();
    const m = new ZoomGestureMachine(h.target);
    expect(m.onWheel(wheel(40, 5))).toBe(true);
    expect(h.only('pan')).toEqual([['pan', -40, -5, 100, 80, 'wheel']]);
  });

  it('leaves a bare wheel to the page under `modifier`, and takes the ⌘-wheel', () => {
    const h = harness();
    const m = new ZoomGestureMachine(h.target, { wheel: 'modifier' });
    expect(m.onWheel(wheel(0, -100))).toBe(false);
    expect(h.calls).toEqual([]);
    expect(m.onWheel(wheel(0, -100, { metaKey: true }))).toBe(true);
    expect(h.only('zoom')).toHaveLength(1);
  });

  it('reads nothing under `none` — the surface keeps its own wheel', () => {
    const h = harness();
    const m = new ZoomGestureMachine(h.target, { wheel: 'none' });
    expect(m.onWheel(wheel(0, -100, { ctrlKey: true }))).toBe(false);
    expect(h.calls).toEqual([]);
  });
});

describe('a pinch', () => {
  it('zooms from the scale it began with, by the spread ratio, about the LIVE centre — pan first', () => {
    const h = harness({ scale: 2 });
    const m = new ZoomGestureMachine(h.target);
    m.onDown(touch(1, 100, 100));
    m.onDown(touch(2, 200, 100));
    expect(m.pinching).toBe(true);
    expect(h.only('takeover')).toHaveLength(1);
    // Fingers spread to 200 apart and drift 10px right.
    m.onMove(touch(1, 60, 100));
    m.onMove(touch(2, 270, 100));
    const pans = h.only('pan');
    const zooms = h.only('zoom');
    expect(pans[pans.length - 1]).toEqual(['pan', 35, 0, 165, 100, 'pinch']);
    // spread 100 → 210: the START scale × 2.1, never the previous frame's × something.
    expect(zooms[zooms.length - 1]).toEqual(['zoom', 2 * 2.1, 165, 100, 'pinch']);
  });

  it('hands the pan to the finger left when the other lifts, without a new press', () => {
    const drags: DragStart[] = [];
    const h = harness({
      drag: (s) => {
        drags.push(s);
        return 'pan';
      },
    });
    const m = new ZoomGestureMachine(h.target);
    m.onDown(touch(1, 100, 100));
    m.onDown(touch(2, 200, 100));
    m.onUp(touch(2, 200, 100));
    expect(m.pinching).toBe(false);
    expect(drags[drags.length - 1]).toMatchObject({ x: 100, y: 100, handoff: true, pointer: null });
    // And it moves at once, no slop to cross again.
    m.onMove(touch(1, 110, 104));
    expect(h.only('pan').pop()).toEqual(['pan', 10, 4, 110, 104, 'drag']);
    expect(h.only('capture')).toHaveLength(0);
  });

  it('counts a finger that landed on a control, without dragging it', () => {
    const h = harness({ drag: () => 'pan' });
    const m = new ZoomGestureMachine(h.target);
    m.onDown({ ...touch(1, 100, 100), overControl: true });
    expect(h.only('dragging')).toHaveLength(0);
    m.onMove(touch(1, 140, 100));
    expect(h.only('pan')).toHaveLength(0);
    m.onDown(touch(2, 200, 100));
    expect(m.pinching).toBe(true);
  });

  it('cancels the surface’s own drag when the second finger lands', () => {
    const ended: boolean[] = [];
    const handler: DragHandler = { move: () => {}, end: (e) => ended.push(e.cancelled) };
    const h = harness({ drag: () => handler });
    const m = new ZoomGestureMachine(h.target);
    m.onDown(touch(1, 100, 100));
    m.onMove(touch(1, 130, 100));
    m.onDown(touch(2, 200, 100));
    expect(ended).toEqual([true]);
    expect(h.only('takeover')).toHaveLength(1);
  });

  it('ignores a third finger and a mouse while pinching', () => {
    const h = harness({ drag: () => 'pan' });
    const m = new ZoomGestureMachine(h.target);
    m.onDown(touch(1, 100, 100));
    m.onDown(touch(2, 200, 100));
    m.onDown(touch(3, 150, 150));
    m.onDown({ ...mouse(50, 50), id: 9 });
    m.onMove({ ...mouse(90, 50), id: 9 });
    expect(h.only('pan').filter((c) => c[5] === 'drag')).toHaveLength(0);
  });
});

describe('one pointer', () => {
  it('pans past the slop, captured for a mouse, and reports dragging', () => {
    const h = harness({ drag: () => 'pan' });
    const m = new ZoomGestureMachine(h.target);
    m.onDown(mouse(100, 100, 0));
    expect(h.only('capture')).toEqual([['capture', 1]]);
    expect(m.onMove(mouse(101, 100, 8))).toBe(false);
    expect(h.only('pan')).toHaveLength(0);
    expect(m.onMove(mouse(100 + DRAG_SLOP + 2, 100, 16))).toBe(true);
    expect(h.only('dragging')).toEqual([['dragging', true]]);
    // The step is measured from the last sample, not from the press — no jump.
    expect(h.only('pan').pop()).toEqual(['pan', DRAG_SLOP + 1, 0, 100 + DRAG_SLOP + 2, 100, 'drag']);
    m.onUp(mouse(120, 100, 32));
    expect(h.only('dragging').pop()).toEqual(['dragging', false]);
    expect(m.dragging).toBe(false);
  });

  it('gives a handler the totals and the speed, and says when it was cancelled', () => {
    const moves: number[] = [];
    let end: { totalX: number; speedX: number; cancelled: boolean } | null = null;
    const handler: DragHandler = {
      move: (mv) => moves.push(mv.totalX),
      end: (e) => (end = e),
    };
    const h = harness({ drag: () => handler });
    const m = new ZoomGestureMachine(h.target, { slop: 6 });
    m.onDown(mouse(0, 0, 0));
    m.onMove(mouse(10, 0, 10));
    m.onMove(mouse(30, 0, 20));
    expect(moves).toEqual([10, 30]);
    m.onUp(mouse(30, 0, 30));
    expect(end).toEqual({ totalX: 30, totalY: 0, speedX: 2, cancelled: false });
    // Not reported as the machine's own dragging: the handler owns it.
    expect(h.only('dragging')).toHaveLength(0);
  });

  it('is refused by a surface that answers null, and by a secondary button', () => {
    const h = harness({ drag: () => null });
    const m = new ZoomGestureMachine(h.target);
    m.onDown(mouse(0, 0));
    m.onMove(mouse(40, 0, 10));
    expect(h.only('pan')).toHaveLength(0);
    expect(h.only('capture')).toHaveLength(0);
    const h2 = harness({ drag: () => 'pan' });
    const m2 = new ZoomGestureMachine(h2.target);
    m2.onDown(mouse(0, 0, 0, { button: 2 }));
    expect(h2.only('gesture')).toHaveLength(0);
  });
});
