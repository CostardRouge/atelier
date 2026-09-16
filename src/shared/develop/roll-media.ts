/**
 * Where a roll picture's BYTES are, told apart from where its numbers are.
 *
 * A roll holds references (`roll-types.ts`); the pixels are found at the
 * moment a picture is looked at. A picture from a Winnow is fetched back by
 * the roll itself from the address its ref carries (`resolve-media.ts`),
 * never by making the person tick it in the Library again — that was the
 * friction the maintainer named on 2026-09-16. These are the rules that
 * decide what is asked for, in which order, and what is kept; the hook that
 * runs them is `tools/develop/use-roll-media.ts`.
 *
 * Pure and DOM-free.
 */

import { buildAssets } from '../library/assets';
import type { SavedMediaRef } from '../projects/project-types';
import { sameMediaRef } from './roll-types';

/** What the editor can say about one picture's bytes. */
export type PictureAvailability =
  /** In hand — from the Library, or fetched by the roll. */
  | { kind: 'ready' }
  /** Being fetched from its instance right now. */
  | { kind: 'fetching'; sourceId: string }
  /** On a connected instance, not asked for yet (it is not near the open picture). */
  | { kind: 'waiting'; sourceId: string }
  /** The instance answered badly; `loginUrl` when signing in is the answer. */
  | { kind: 'failed'; sourceId: string; problem: string; loginUrl?: string }
  /** The instance no longer has it (purged, or soft-deleted). */
  | { kind: 'gone'; sourceId: string }
  /** Kept on an instance this browser has not been connected to. */
  | { kind: 'unconnected'; sourceId: string }
  /** A file from this machine that the Library does not hold right now. */
  | { kind: 'local' };

/** How far either side of the open picture the roll fetches ahead. */
export const FETCH_RADIUS = 2;
/** How far either side a fetched picture is kept before it is let go. */
export const KEEP_RADIUS = 6;

/**
 * The pictures to fetch, in the order they are wanted: the open one, then
 * its neighbours alternating after/before, out to `radius`. The strip is read
 * forwards, so the next picture comes before the previous one.
 */
export function fetchOrder(ids: readonly string[], openId: string | null, radius = FETCH_RADIUS): string[] {
  if (ids.length === 0) return [];
  const at = Math.max(0, openId ? ids.indexOf(openId) : 0);
  const out = [ids[at]];
  for (let d = 1; d <= radius; d++) {
    if (at + d < ids.length) out.push(ids[at + d]);
    if (at - d >= 0) out.push(ids[at - d]);
  }
  return out;
}

/** The pictures whose fetched bytes are worth keeping while `openId` is open. */
export function keepWindow(ids: readonly string[], openId: string | null, radius = KEEP_RADIUS): Set<string> {
  if (ids.length === 0) return new Set();
  const at = Math.max(0, openId ? ids.indexOf(openId) : 0);
  return new Set(ids.slice(Math.max(0, at - radius), at + radius + 1));
}

export interface AvailabilitySummary {
  fetching: number;
  /** Failed or gone, per instance: the problem worth saying once. */
  failed: number;
  gone: number;
  unconnected: number;
  local: number;
  /** The first instance that failed or no longer has a picture. */
  sourceId: string | null;
  /** The first instance this browser is not connected to — a different one, often. */
  unconnectedSourceId: string | null;
  /** The first problem, as the instance put it. */
  problem: string | null;
  loginUrl: string | null;
}

/** One line's worth of facts about a roll's bytes, in the strip's order. */
export function summarizeAvailability(
  ids: readonly string[],
  availability: ReadonlyMap<string, PictureAvailability>,
): AvailabilitySummary {
  const out: AvailabilitySummary = {
    fetching: 0,
    failed: 0,
    gone: 0,
    unconnected: 0,
    local: 0,
    sourceId: null,
    unconnectedSourceId: null,
    problem: null,
    loginUrl: null,
  };
  for (const id of ids) {
    const a = availability.get(id);
    if (!a) continue;
    switch (a.kind) {
      case 'fetching':
        out.fetching += 1;
        break;
      case 'failed':
        out.failed += 1;
        if (out.sourceId === null) out.sourceId = a.sourceId;
        if (out.problem === null) out.problem = a.problem;
        if (out.loginUrl === null) out.loginUrl = a.loginUrl ?? null;
        break;
      case 'gone':
        out.gone += 1;
        if (out.sourceId === null) out.sourceId = a.sourceId;
        break;
      case 'unconnected':
        out.unconnected += 1;
        if (out.unconnectedSourceId === null) out.unconnectedSourceId = a.sourceId;
        break;
      case 'local':
        out.local += 1;
        break;
      default:
        break;
    }
  }
  return out;
}

/** What the stage says over a picture whose bytes are not in hand. */
export function availabilityText(name: string, a: PictureAvailability | undefined): string {
  switch (a?.kind) {
    case 'fetching':
      return `Fetching ${name} from ${a.sourceId}…`;
    case 'waiting':
      return `${name} is on ${a.sourceId} — fetching it next.`;
    case 'failed':
      return `${name} could not be fetched: ${a.problem}`;
    case 'gone':
      return `${a.sourceId} no longer has ${name}. Its numbers are kept.`;
    case 'unconnected':
      return `${name} is kept on ${a.sourceId}, which this browser is not connected to — connect it in Sources.`;
    case 'local':
    default:
      return `${name} is a file from this computer that is not open right now — reopen its folder, or drop it on the roll. Its numbers can still be set.`;
  }
}

/**
 * The calendar day a picture was taken, in THIS device's zone (`YYYY-MM-DD`)
 * — the day the "add a day" sheet opens on. A ref's `lastModified` is the
 * capture instant for a fetched file (`captureMtime`); an unknown one (0)
 * falls back to `now`.
 */
export function pictureDay(lastModified: number, now: number = Date.now()): string {
  const d = new Date(lastModified > 0 ? lastModified : now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The photographs among `files`, as the Library would read them: grouped by
 * base name, a RAW yielding to its own JPEG, clips and logs left out.
 */
export function photoFiles(files: readonly File[]): File[] {
  return buildAssets([...files]).flatMap((a) => (a.kind === 'photo' && a.parts.image ? [a.parts.image] : []));
}

/**
 * What a set of incoming refs means for a roll: how many are pictures it
 * already holds (found again), and which are new — each once, in order.
 */
export function splitByRoll(
  held: readonly SavedMediaRef[],
  incoming: readonly SavedMediaRef[],
): { found: number; fresh: SavedMediaRef[] } {
  let found = 0;
  const fresh: SavedMediaRef[] = [];
  for (const ref of incoming) {
    if (held.some((h) => sameMediaRef(h, ref))) found += 1;
    else if (!fresh.some((f) => sameMediaRef(f, ref))) fresh.push(ref);
  }
  return { found, fresh };
}

