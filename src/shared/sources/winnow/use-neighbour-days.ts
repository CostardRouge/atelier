import { useEffect, useRef, useState } from 'react';
import type { LibraryHalf, WinnowClient } from './client';
import type { DaySpan } from '../scope-override';
import {
  firstWindow,
  nearestMediaDay,
  restWindow,
  type MediaDay,
  type Side,
} from './day-walk';

/** What is known of the nearest day with media on one side. */
export type Neighbour =
  | { state: 'asking' }
  | { state: 'none' }
  | { state: 'failed' }
  | ({ state: 'day' } & MediaDay);

export type NeighbourDays = Record<Side, Neighbour>;

const ASKING: NeighbourDays = { before: { state: 'asking' }, after: { state: 'asking' } };

/**
 * The nearest day holding media before and after a span, asked of the
 * instance's calendar (`day-walk.ts` for the two-step walk). Filtered by the
 * same half the tab lists, or the next day could be one whose pictures the tab
 * then does not show.
 *
 * Nothing is asked while `enabled` is false — the lightbox is what wants
 * this, and a closed one costs no request. Answers are kept for as long as it
 * stays enabled, so walking back to a day already visited asks nothing, and
 * are forgotten when it closes: counts move as the instance ingests.
 */
export function useNeighbourDays(
  client: WinnowClient | null,
  span: DaySpan,
  half: LibraryHalf | null,
  today: string,
  enabled: boolean,
): NeighbourDays {
  const [found, setFound] = useState<NeighbourDays>(ASKING);
  const cache = useRef(new Map<string, Neighbour>());
  const { from, to } = span;

  useEffect(() => {
    if (!enabled) cache.current.clear();
  }, [enabled]);

  useEffect(() => {
    setFound(ASKING);
    if (!enabled || !client) return;
    let cancelled = false;
    const filter = half ? { half } : {};
    const key = (side: Side) => `${side}|${from}|${to}|${half ?? 'all'}`;

    const walk = async (side: Side): Promise<Neighbour> => {
      const here = { from, to };
      const first = firstWindow(here, side, today);
      if (!first) return { state: 'none' };
      const cal = await client.calendar(first.from, first.to, filter);
      const near = nearestMediaDay(cal.days, here, side);
      if (near) return { state: 'day', ...near };
      const rest = restWindow(first, side, cal.bounds, today);
      if (!rest) return { state: 'none' };
      const more = await client.calendar(rest.from, rest.to, filter);
      const far = nearestMediaDay(more.days, here, side);
      return far ? { state: 'day', ...far } : { state: 'none' };
    };

    for (const side of ['before', 'after'] as const) {
      const hit = cache.current.get(key(side));
      const settle = (n: Neighbour) => {
        if (cancelled) return;
        if (n.state !== 'failed') cache.current.set(key(side), n);
        setFound((cur) => ({ ...cur, [side]: n }));
      };
      if (hit) settle(hit);
      else walk(side).then(settle, () => settle({ state: 'failed' }));
    }
    return () => {
      cancelled = true;
    };
  }, [client, from, to, half, today, enabled]);

  return found;
}
