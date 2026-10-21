/**
 * A day's pictures, proposed for a piece: the few worth a slide, spread over
 * the day, each with the reason it was chosen.
 *
 * Read only from what Winnow already sends on every row — its culling (a
 * pick, stars, a reject) and its burst piles — so nothing is fetched,
 * measured or guessed. A PROPOSAL: the Library ticks these and the person
 * keeps, drops or adds before anything is written (`MediaIntake`), and every
 * pick says why, in Winnow's own words.
 *
 * 1. A rejected frame is never proposed, nor one already in the piece.
 * 2. A burst is one moment: only its best frame stands for it (Winnow's
 *    cover on a tie), said as «best of 5».
 * 3. The day is cut into as many equal windows of time as pictures asked
 *    for, and each window gives its best frame — so a morning of thirty
 *    shots does not crowd out the evening's two. A frame swiped past in
 *    Winnow (a skip) never stands for a window. What the empty windows
 *    leave over goes to the best frames left anywhere.
 * 4. The answer is in the order the frames were taken.
 *
 * Pure and DOM-free.
 */

import type { WinnowAssetRow } from './client';
import { cullingFromRow } from './culling';
import { localClock, localWallMs } from './capture-moment';

export interface SuggestedPick {
  id: number;
  /** Why it was chosen, in a few words — «Pick · ★4», «best of 5», «only one around 14:20». */
  reason: string;
}

type Row = Pick<
  WinnowAssetRow,
  'id' | 'media_type' | 'captured_at' | 'gps_lat' | 'gps_lon' | 'camera_model'
> &
  Partial<
    Pick<
      WinnowAssetRow,
      | 'verdict'
      | 'star'
      | 'color_label'
      | 'burst_id'
      | 'burst_cover_id'
      | 'burst_count'
      | 'captured_at_source'
      | 'capture_offset_min'
      | 'exif_offset_min'
    >
  >;

/** How strongly Winnow vouched for a frame: a pick over stars over nothing, a skip below. */
function scoreOf(row: Row): number {
  const c = cullingFromRow(row);
  if (!c) return 0;
  if (c.verdict === 'reject') return -Infinity;
  return (c.verdict === 'pick' ? 10 : 0) + c.star - (c.verdict === 'skip' ? 1 : 0);
}

function timeOf(row: Row): number | null {
  return localWallMs(row);
}

interface Candidate {
  row: Row;
  score: number;
  at: number | null;
  /** The size of the burst it stands for, 1 when none. */
  stands: number;
}

/**
 * The frames to propose for `count` slides, best of each window of the day,
 * in time order. `held` says a frame is already in the work.
 */
export function suggestPicks(
  rows: readonly Row[],
  count: number,
  held: (row: Row) => boolean = () => false,
): SuggestedPick[] {
  if (count <= 0) return [];
  // 1 + 2: the frames worth considering, one per burst.
  const bursts = new Map<number, Candidate>();
  const loose: Candidate[] = [];
  for (const row of rows) {
    if (row.media_type !== 'photo' && row.media_type !== 'video') continue;
    const score = scoreOf(row);
    if (score === -Infinity || held(row)) continue;
    const c: Candidate = { row, score, at: timeOf(row), stands: 1 };
    const burst = row.burst_id ?? null;
    if (burst === null || (row.burst_count ?? 1) <= 1) {
      loose.push(c);
      continue;
    }
    const best = bursts.get(burst);
    const isCover = row.burst_cover_id === row.id;
    if (!best || score > best.score || (score === best.score && isCover)) {
      bursts.set(burst, { ...c, stands: row.burst_count ?? 1 });
    }
  }
  const pool = [...loose, ...bursts.values()];
  if (pool.length <= count) return finish(pool, pool.length);

  // 3: equal windows of the day's time, each giving its best frame.
  // A frame Winnow saw and swiped past (a skip) never stands for a window;
  // it may only fill what nothing better can.
  const dated = pool.filter((c) => c.at !== null && c.score >= 0);
  const chosen = new Set<Candidate>();
  if (dated.length >= 2) {
    const first = Math.min(...dated.map((c) => c.at!));
    const last = Math.max(...dated.map((c) => c.at!));
    const span = Math.max(1, last - first);
    const windowOf = (c: Candidate) => Math.min(count - 1, Math.floor(((c.at! - first) / span) * count));
    for (let w = 0; w < count; w += 1) {
      const inWindow = dated.filter((c) => windowOf(c) === w);
      const best = bestOf(inWindow);
      if (best) chosen.add(best);
    }
  }
  // What the empty windows leave over: the best frames left anywhere.
  for (const c of [...pool].sort(byMerit)) {
    if (chosen.size >= count) break;
    chosen.add(c);
  }
  return finish([...chosen], count);
}

function byMerit(a: Candidate, b: Candidate): number {
  return b.score - a.score || (a.at ?? Infinity) - (b.at ?? Infinity) || a.row.id - b.row.id;
}

function bestOf(list: readonly Candidate[]): Candidate | null {
  return list.length ? [...list].sort(byMerit)[0] : null;
}

/** 4: in the order taken, each with its reason. */
function finish(list: Candidate[], count: number): SuggestedPick[] {
  return list
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.row.id - b.row.id)
    .slice(0, count)
    .map((c) => ({ id: c.row.id, reason: reasonOf(c) }));
}

function reasonOf(c: Candidate): string {
  const parts: string[] = [];
  const culling = cullingFromRow(c.row);
  if (culling?.verdict === 'pick') parts.push('Pick');
  if (culling && culling.star > 0) parts.push(`★${culling.star}`);
  if (c.stands > 1) parts.push(`best of ${c.stands}`);
  if (parts.length) return parts.join(' · ');
  const clock = localClock(c.row);
  return clock ? `covers ${clock}` : 'to fill the day';
}
