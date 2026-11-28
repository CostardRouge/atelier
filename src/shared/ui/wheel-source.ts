/**
 * Which HAND turned a wheel event — a trackpad's two fingers or a mouse's
 * notched wheel — for a surface where the two mean different things: two
 * fingers sliding PAN a zoomed picture (as in every photo editor on a Mac),
 * a wheel's notches ZOOM it. A pinch is neither: it arrives as a ctrl-wheel
 * and is read before this is asked.
 *
 * The browser does not say which device it was, so this reads the event's
 * shape, the way every web editor does:
 *  - a delta in LINES or pages (`deltaMode` ≠ 0) is a notched wheel (Firefox);
 *  - a sideways component is a trackpad — a mouse wheel turns one axis;
 *  - a legacy `wheelDeltaY` in whole multiples of 120 is a notch (Chrome and
 *    Safari report a notch as ±120, a trackpad's glide in small steps);
 *  - with no legacy delta, a small step is a glide and a big one a notch.
 * A glide is a STREAM, so once an event reads as a trackpad the events that
 * follow it within `STREAM_MS` stay one — a fast flick's single event that
 * happens to look like a notch never turns into a zoom mid-pan.
 *
 * DOM-free and tested (`wheel-source.test.ts`).
 */

export type WheelHand = 'trackpad' | 'mouse';

/** The bits of a wheel event the reading needs. */
export interface WheelShape {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages; absent reads as pixels. */
  deltaMode?: number;
  /** The legacy, non-standard `wheelDeltaY` where the browser still sends it. */
  wheelDeltaY?: number;
  /** Event time, ms. */
  t: number;
}

/** Events closer than this to a trackpad's are the same glide. */
export const STREAM_MS = 250;

/** With no legacy delta, a step this large (px) is read as a notch. */
const NOTCH_PX = 50;

/** One event read on its own, with no memory of the stream. */
export function wheelHandOf(e: WheelShape): WheelHand {
  if (e.deltaMode !== undefined && e.deltaMode !== 0) return 'mouse';
  if (e.deltaX !== 0) return 'trackpad';
  if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0) {
    return Math.abs(e.wheelDeltaY) % 120 === 0 ? 'mouse' : 'trackpad';
  }
  return Math.abs(e.deltaY) >= NOTCH_PX ? 'mouse' : 'trackpad';
}

/** The reading with the stream's memory: one per surface. */
export class WheelSource {
  private trackpadAt = -Infinity;

  read(e: WheelShape): WheelHand {
    const own = wheelHandOf(e);
    if (own === 'trackpad' || e.t - this.trackpadAt < STREAM_MS) {
      this.trackpadAt = e.t;
      return 'trackpad';
    }
    return 'mouse';
  }
}
