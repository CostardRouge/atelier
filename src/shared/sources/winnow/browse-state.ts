/**
 * Where you were looking in a source's browser, remembered per instance.
 *
 * Adding media is not one act: a trip is picked over several sittings, a day
 * at a time, usually under the same narrowing. Losing the month, the filters
 * and the open day every time the modal closes makes the second sitting cost
 * as much as the first.
 *
 * What is remembered is the PLACE — view, filters, month, the open day or
 * folder — and the fidelity, which is a preference. What is deliberately NOT
 * remembered is the **selection**: "Add 12 to library" downloads gigabytes,
 * and a tick list restored from days ago is a list nobody just looked at. Each
 * sitting picks afresh; `all` makes that one click.
 *
 * `localStorage`, keyed by source, because this is a UI preference in the same
 * sense the sidebar's collapsed flag is — and it degrades to "start fresh",
 * which is exactly today's behaviour.
 */

import type { FilterQuery } from './client';

export type BrowseView = 'day' | 'session' | 'chapter';

export interface BrowseState {
  view: BrowseView;
  filter: FilterQuery;
  /** `YYYY-MM`. */
  month: string;
  /** The open day, `YYYY-MM-DD`, or null. */
  day: string | null;
  /** The open folder's Winnow session id, or null. */
  sessionId: number | null;
  /** The open timeline chapter's id, or null. */
  chapterId: string | null;
  fidelity: 'proxy' | 'original';
}

const KEY = 'atelier.sources.winnow.browse.v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read one instance's place back, rejecting anything that is not the shape we
 * wrote. A stored month of "banana" would reach `monthSpan` and produce a
 * calendar of nothing, so this is a guard, not a formality.
 */
export function readBrowseState(sourceId: string): BrowseState | null {
  let all: unknown;
  try {
    all = JSON.parse(storage()?.getItem(KEY) ?? '{}');
  } catch {
    return null;
  }
  if (typeof all !== 'object' || all === null) return null;
  const raw = (all as Record<string, unknown>)[sourceId];
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.month !== 'string' || !MONTH_RE.test(s.month)) return null;

  const filter = typeof s.filter === 'object' && s.filter !== null ? s.filter : {};
  const f = filter as Record<string, unknown>;
  return {
    view: s.view === 'session' || s.view === 'chapter' ? s.view : 'day',
    filter: {
      ...(f.mediaType === 'photo' || f.mediaType === 'video'
        ? { mediaType: f.mediaType }
        : {}),
      ...(typeof f.ext === 'string' && f.ext ? { ext: f.ext } : {}),
      ...(typeof f.device === 'string' && f.device ? { device: f.device } : {}),
    },
    month: s.month,
    day: typeof s.day === 'string' && DAY_RE.test(s.day) ? s.day : null,
    sessionId: typeof s.sessionId === 'number' && Number.isFinite(s.sessionId)
      ? s.sessionId
      : null,
    chapterId: typeof s.chapterId === 'string' && s.chapterId ? s.chapterId : null,
    fidelity: s.fidelity === 'original' ? 'original' : 'proxy',
  };
}

/** Remember this instance's place. Storage failure is silently fine. */
export function writeBrowseState(sourceId: string, state: BrowseState): void {
  const store = storage();
  if (!store) return;
  let all: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '{}');
    if (typeof parsed === 'object' && parsed !== null) {
      all = parsed as Record<string, unknown>;
    }
  } catch {
    /* overwrite whatever was unreadable */
  }
  all[sourceId] = state;
  try {
    store.setItem(KEY, JSON.stringify(all));
  } catch {
    /* quota or private mode — the place is a convenience, not data */
  }
}

/** Forget one instance's place — used when its connection is removed. */
export function forgetBrowseState(sourceId: string): void {
  const store = storage();
  if (!store) return;
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return;
    const all = parsed as Record<string, unknown>;
    delete all[sourceId];
    store.setItem(KEY, JSON.stringify(all));
  } catch {
    /* nothing readable to forget */
  }
}
