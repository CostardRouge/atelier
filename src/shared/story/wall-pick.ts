/**
 * The wall chosen by RULES (his ask and the lab
 * https://claude.ai/artifact/G4cSeFTS2Dv325Us97pWDJ, his picks: the rules work
 * on the counted span or on what was ticked in the picker; a picture taken off
 * is replaced at once by the next under the same rules; the default order is
 * Picked · Stars · Edited · People · Sharp).
 *
 * Three steps over the span's pictures, then his corrections:
 * 1. LEAVE OUT what Winnow rejected, screenshots and saved images (no camera
 *    named them), all but the best of a burst, look-alikes of a picture kept
 *    a few minutes before in the same folder (Winnow's image fingerprint);
 * 2. SPREAD the places over days, folders or weeks — the same for each, or more
 *    for a busy one, never more than three times a quiet one's;
 * 3. PREFER inside each group by the rules in his order, the first deciding,
 *    the next breaking its ties.
 * PINS go first whatever the rules say, REMOVED pictures never come back. A
 * rule whose fact Winnow does not have for a picture simply does not count for
 * it. Every picture keeps the reason it is there. (pure)
 */
import type { WinnowAssetRow } from '../sources/winnow/client';

export type PreferKey = 'pick' | 'stars' | 'edited' | 'faces' | 'sharp';
export const PREFER_KEYS: readonly PreferKey[] = ['pick', 'stars', 'edited', 'faces', 'sharp'];
export const PREFER_LABEL: Record<PreferKey, string> = {
  pick: 'Picked in Winnow',
  stars: 'Stars',
  edited: 'Edited',
  faces: 'People in it',
  sharp: 'Sharp',
};

export type LeaveKey = 'reject' | 'screen' | 'burst' | 'alike';
export const LEAVE_KEYS: readonly LeaveKey[] = ['reject', 'screen', 'burst', 'alike'];

export interface WallRules {
  /** What the places are spread across. */
  unit: 'day' | 'folder' | 'week';
  /** Each group the same share, or more for a busy one (capped at three times the median group's). */
  share: 'even' | 'busy';
  /** What is left out (each on unless set false). */
  leave: Partial<Record<LeaveKey, boolean>>;
  /** The preferences in order, the first deciding — absent from the list is off. */
  prefer: PreferKey[];
}

export const DEFAULT_WALL_RULES: WallRules = { unit: 'day', share: 'busy', leave: {}, prefer: [...PREFER_KEYS] };

/** What the rules read of a picture — from a Winnow row (`candidateOf`). */
export interface WallCandidate {
  id: number;
  day: string;
  folder: number | null;
  /** Capture time, seconds — what « a few minutes apart » measures. */
  at: number;
  pick: boolean;
  reject: boolean;
  stars: number;
  edited: boolean;
  faces: number;
  /** Winnow's sharpness measure, when it has one. */
  sharp: number | null;
  burst: number | null;
  screen: boolean;
  /** Winnow's 64-bit image fingerprint, when the row carries it. */
  phash: bigint | null;
}

/** The fingerprint a row carries (a 64-bit integer, which a JSON answer gives as a string or a lossy number). */
function phashOf(raw: unknown): bigint | null {
  try {
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return BigInt.asUintN(64, BigInt(raw));
    if (typeof raw === 'number' && Number.isSafeInteger(raw)) return BigInt.asUintN(64, BigInt(raw));
  } catch {
    // not a fingerprint
  }
  return null;
}

/** A Winnow row as the rules read it. Screens and saved images: nothing named a camera, or a PNG. */
export function candidateOf(row: WinnowAssetRow, day: string): WallCandidate {
  const extra = row as WinnowAssetRow & { sharpness?: unknown; phash?: unknown; face_count?: unknown; edit_count?: unknown; device?: unknown };
  const t = row.captured_at ? Date.parse(row.captured_at) / 1000 : NaN;
  return {
    id: row.id,
    day,
    folder: row.session_id ?? null,
    at: Number.isFinite(t) ? t : 0,
    pick: row.verdict === 'pick',
    reject: row.verdict === 'reject',
    stars: typeof row.star === 'number' ? row.star : 0,
    edited: typeof extra.edit_count === 'number' && extra.edit_count > 0,
    faces: typeof extra.face_count === 'number' ? extra.face_count : 0,
    sharp: typeof extra.sharpness === 'number' && Number.isFinite(extra.sharpness) ? extra.sharpness : null,
    burst: typeof row.burst_id === 'number' ? row.burst_id : null,
    screen: (row.ext ?? '').toLowerCase().replace(/^\./, '') === 'png' || (!row.camera_model && !(typeof extra.device === 'string' && extra.device)),
    phash: phashOf(extra.phash),
  };
}

const SCORE: Record<PreferKey, (c: WallCandidate) => number | null> = {
  pick: (c) => (c.pick ? 1 : 0),
  stars: (c) => c.stars,
  edited: (c) => (c.edited ? 1 : 0),
  faces: (c) => (c.faces > 0 ? 1 : 0),
  sharp: (c) => c.sharp,
};

/** Better first: each rule in turn, a missing fact counting for nothing; then capture time. */
export function rankBy(prefer: readonly PreferKey[]): (a: WallCandidate, b: WallCandidate) => number {
  return (a, b) => {
    for (const k of prefer) {
      const sa = SCORE[k](a);
      const sb = SCORE[k](b);
      if (sa === null || sb === null || sa === sb) continue;
      return sb - sa;
    }
    return a.at - b.at || a.id - b.id;
  };
}

const bits = (x: bigint) => {
  let n = 0;
  for (let v = x; v; v &= v - 1n) n++;
  return n;
};
/** Two fingerprints this close are one look (Winnow's own duplicate threshold is 10 bits). */
const ALIKE_BITS = 8;
/** Look-alikes are only looked for within this many seconds, in the same folder. */
const ALIKE_SECONDS = 10 * 60;

const weekOf = (day: string) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? `w${Math.floor((t / 86_400_000 + 3) / 7)}` : day;
};

export interface WallChoice {
  id: number;
  day: string;
  /** Why it is on the wall, in a few words. */
  why: string;
  pinned: boolean;
}

export interface WallOutcome {
  picks: WallChoice[];
  /** How many each rule left out, for the panel. */
  left: Record<LeaveKey, number>;
  /** How many pictures the rules worked on, and over how many groups. */
  pool: number;
  groups: number;
}

/**
 * The wall's `n` pictures from `candidates` under `rules`, his `pins` first and
 * his `removed` never, in day order.
 */
export function pickWall(
  candidates: readonly WallCandidate[],
  rules: WallRules,
  n: number,
  corrections: { pins?: readonly number[]; removed?: readonly number[] } = {},
): WallOutcome {
  const pins = new Set(corrections.pins ?? []);
  const removed = new Set(corrections.removed ?? []);
  const on = (k: LeaveKey) => rules.leave[k] !== false;
  const rank = rankBy(rules.prefer);
  const left: Record<LeaveKey, number> = { reject: 0, screen: 0, burst: 0, alike: 0 };

  let pool = candidates.filter((c) => !removed.has(c.id));
  if (on('reject')) pool = pool.filter((c) => (c.reject && !pins.has(c.id) ? (left.reject++, false) : true));
  if (on('screen')) pool = pool.filter((c) => (c.screen && !pins.has(c.id) ? (left.screen++, false) : true));
  if (on('burst')) {
    const best = new Map<number, WallCandidate>();
    for (const c of pool) {
      if (c.burst === null) continue;
      const was = best.get(c.burst);
      if (!was || rank(c, was) < 0) best.set(c.burst, c);
    }
    pool = pool.filter((c) => (c.burst === null || best.get(c.burst) === c || pins.has(c.id) ? true : (left.burst++, false)));
  }

  const groupOf = (c: WallCandidate) => (rules.unit === 'folder' ? `f${c.folder ?? c.day}` : rules.unit === 'week' ? weekOf(c.day) : c.day);
  const groups = new Map<string, WallCandidate[]>();
  for (const c of pool) {
    const g = groupOf(c);
    const list = groups.get(g);
    if (list) list.push(c);
    else groups.set(g, [c]);
  }
  for (const list of groups.values()) list.sort(rank);
  // Groups in time order, so a round of the wall reads through the trip.
  const keys = [...groups.keys()].sort((a, b) => (groups.get(a)![0].day < groups.get(b)![0].day ? -1 : 1));

  const sizes = keys.map((k) => groups.get(k)!.length).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 1;
  const weight = (k: string) => (rules.share === 'even' ? 1 : Math.min(groups.get(k)!.length, median * 3));
  const total = keys.reduce((s, k) => s + weight(k), 0) || 1;
  const quota = new Map(keys.map((k) => [k, Math.max(1, Math.round((n * weight(k)) / total))]));

  const chosen = new Map<number, WallChoice>();
  const taken = new Map<string, number>();
  const keptIn = new Map<string, WallCandidate[]>();
  for (const id of pins) {
    const c = candidates.find((x) => x.id === id);
    if (!c || removed.has(id)) continue;
    chosen.set(id, { id, day: c.day, why: 'pinned by you', pinned: true });
    const g = groupOf(c);
    taken.set(g, (taken.get(g) ?? 0) + 1);
    keptIn.set(g, [...(keptIn.get(g) ?? []), c]);
  }
  const alike = (c: WallCandidate, kept: readonly WallCandidate[]) =>
    on('alike') &&
    c.phash !== null &&
    kept.some((k) => k.phash !== null && k.folder === c.folder && Math.abs(k.at - c.at) <= ALIKE_SECONDS && bits(k.phash ^ c.phash!) <= ALIKE_BITS);

  const cursor = new Map(keys.map((k) => [k, 0]));
  // Round after round, each group still under its share takes its next best — every group one
  // first — until the wall is full; when the shares are spent and places remain, any group with
  // pictures left fills them.
  let fill = false;
  for (let round = 0; chosen.size < n; round++) {
    let any = false;
    for (const k of keys) {
      if (chosen.size >= n) break;
      const have = taken.get(k) ?? 0;
      if (!fill && have >= (round === 0 ? 1 : quota.get(k)!)) continue;
      const list = groups.get(k)!;
      let i = cursor.get(k)!;
      const kept = keptIn.get(k) ?? [];
      while (i < list.length && (chosen.has(list[i].id) || alike(list[i], kept))) {
        if (!chosen.has(list[i].id)) left.alike++;
        i++;
      }
      cursor.set(k, i + 1);
      if (i >= list.length) continue;
      const c = list[i];
      chosen.set(c.id, { id: c.id, day: c.day, why: reason(c, list, i, rules), pinned: false });
      taken.set(k, have + 1);
      keptIn.set(k, [...kept, c]);
      any = true;
    }
    if (!any) {
      if (fill) break;
      fill = true;
    }
  }

  const picks = [...chosen.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return { picks, left, pool: pool.length, groups: keys.length };
}

function reason(c: WallCandidate, list: readonly WallCandidate[], i: number, rules: WallRules): string {
  const unit = rules.unit === 'folder' ? 'folder' : rules.unit === 'week' ? 'week' : 'day';
  const by = rules.prefer.find((k) => {
    const s = SCORE[k](c);
    return s !== null && s !== SCORE[k](list[list.length - 1]);
  });
  const what =
    by === 'pick' ? 'picked in Winnow' : by === 'stars' ? `★${c.stars}` : by === 'edited' ? 'edited' : by === 'faces' ? 'people in it' : by === 'sharp' ? 'the sharpest' : 'the first taken';
  return `${i === 0 ? 'the best' : `#${i + 1}`} of ${list.length} that ${unit} — ${what}`;
}

/** The rules as a script keeps them, kept field by field when well formed. */
export function readWallRules(raw: unknown): WallRules | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const unit = r.unit === 'folder' || r.unit === 'week' ? r.unit : 'day';
  const share = r.share === 'even' ? 'even' : 'busy';
  const leave: Partial<Record<LeaveKey, boolean>> = {};
  if (typeof r.leave === 'object' && r.leave !== null) {
    for (const k of LEAVE_KEYS) if ((r.leave as Record<string, unknown>)[k] === false) leave[k] = false;
  }
  const prefer = Array.isArray(r.prefer) ? [...new Set(r.prefer.filter((k): k is PreferKey => (PREFER_KEYS as readonly unknown[]).includes(k)))] : [...PREFER_KEYS];
  return { unit, share, leave, prefer };
}
