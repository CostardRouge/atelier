/**
 * The CONDITIONS a tool chooses pictures by, from the facts a Winnow row
 * carries — shared by Storytelling's wall (`story/wall-pick.ts`) and Recap's
 * dump, highlights and Sheets (removal lab, his yes of 2026-11-05: «la rendre
 * commune»). What to LEAVE OUT (rejected, screenshots and saved images, all
 * but the best of a burst, look-alikes a few minutes apart in the same
 * folder) and what to PREFER, in his order, the first deciding and the next
 * breaking its ties. A fact Winnow does not have for a picture simply does
 * not count for it.
 *
 * Pure: generic over anything that carries `PictureFacts`.
 */

export type PreferKey = 'fav' | 'pick' | 'stars' | 'edited' | 'faces' | 'sharp';
/** Winnow's ♥ first (2026-11-06, Winnow #355: a «show this» mark beside the culling, the Gallery's only one). */
export const PREFER_KEYS: readonly PreferKey[] = ['fav', 'pick', 'stars', 'edited', 'faces', 'sharp'];
export const PREFER_LABEL: Record<PreferKey, string> = {
  fav: 'Favourite ♥ in Winnow',
  pick: 'Picked in Winnow',
  stars: 'Stars',
  edited: 'Edited',
  faces: 'People in it',
  sharp: 'Sharp',
};

export type LeaveKey = 'reject' | 'screen' | 'burst' | 'alike';
export const LEAVE_KEYS: readonly LeaveKey[] = ['reject', 'screen', 'burst', 'alike'];
export const LEAVE_LABEL: Record<LeaveKey, string> = {
  reject: 'Rejected in Winnow',
  screen: 'Screenshots and saved images',
  burst: 'All but the best of a burst',
  alike: 'Look-alikes a few minutes apart',
};
export const LEAVE_TITLE: Record<LeaveKey, string> = {
  reject: 'Your verdict in Winnow',
  screen: 'No camera named them, or a PNG',
  burst: 'The bursts Winnow already grouped: the best one stays',
  alike: "Winnow's image fingerprint, in the same folder, ten minutes apart at most — where Winnow has one",
};

/** The conditions as a tool keeps them: each leave-out on unless set false, the preferences in order (absent = off). */
export interface PictureRules {
  leave: Partial<Record<LeaveKey, boolean>>;
  prefer: PreferKey[];
  /**
   * The ♥ turned off by hand. A list kept before favourites existed lacks
   * `fav` without meaning «off», so it gets the ♥ first; only this says no.
   */
  favOff?: true;
}

/** The preferences a stored record keeps, the ♥ first in a list that never knew it (`PictureRules.favOff`). */
export function readPrefer(r: Record<string, unknown>): { prefer: PreferKey[]; favOff?: true } {
  if (!Array.isArray(r.prefer)) return { prefer: [...PREFER_KEYS] };
  const prefer = [...new Set(r.prefer.filter((k): k is PreferKey => PREFER_KEYS.includes(k as PreferKey)))];
  if (r.favOff === true) return { prefer: prefer.filter((k) => k !== 'fav'), favOff: true };
  return { prefer: prefer.includes('fav') ? prefer : ['fav', ...prefer] };
}

export const DEFAULT_PICTURE_RULES: PictureRules = { leave: {}, prefer: [...PREFER_KEYS] };

/** The rules read from anything: the leave-outs a tool turned off, its preferences in their order, nothing foreign. */
export function readPictureRules(raw: unknown): PictureRules {
  if (!raw || typeof raw !== 'object') return { leave: {}, prefer: [...PREFER_KEYS] };
  const r = raw as Record<string, unknown>;
  const leave: Partial<Record<LeaveKey, boolean>> = {};
  if (r.leave && typeof r.leave === 'object') for (const k of LEAVE_KEYS) if ((r.leave as Record<string, unknown>)[k] === false) leave[k] = false;
  return { leave, ...readPrefer(r) };
}

export const leaves = (rules: Pick<PictureRules, 'leave'>, k: LeaveKey) => rules.leave[k] !== false;

/** What the conditions read of a picture. */
export interface PictureFacts {
  /** Winnow's ♥ (absent on an older instance: false). */
  fav: boolean;
  pick: boolean;
  reject: boolean;
  stars: number;
  edited: boolean;
  faces: number;
  /** Winnow's sharpness measure, when it has one. */
  sharp: number | null;
  /** Winnow's burst pile, when it made one. */
  burst: number | null;
  /** A screenshot or a saved image: nothing named a camera, or a PNG. */
  screen: boolean;
  /** Winnow's 64-bit image fingerprint, when the row carries it. */
  phash: bigint | null;
  /** The folder (Winnow's session) it was filed in. */
  folder: number | null;
  /** Capture time, seconds — what «a few minutes apart» measures. */
  at: number;
}

/** The fingerprint a row carries (a 64-bit integer, which a JSON answer gives as a string or a lossy number). */
export function phashOf(raw: unknown): bigint | null {
  try {
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return BigInt.asUintN(64, BigInt(raw));
    if (typeof raw === 'number' && Number.isSafeInteger(raw)) return BigInt.asUintN(64, BigInt(raw));
  } catch {
    // not a fingerprint
  }
  return null;
}

const SCORE: Record<PreferKey, (c: PictureFacts) => number | null> = {
  fav: (c) => (c.fav ? 1 : 0),
  pick: (c) => (c.pick ? 1 : 0),
  stars: (c) => c.stars,
  edited: (c) => (c.edited ? 1 : 0),
  faces: (c) => (c.faces > 0 ? 1 : 0),
  sharp: (c) => c.sharp,
};

/** A preference's score of a picture, null when Winnow has no fact for it. */
export const scoreOf = (k: PreferKey, c: PictureFacts): number | null => SCORE[k](c);

/** Better first: each preference in turn, a missing fact counting for nothing; then `tie` (capture time by default). */
export function rankBy<T extends PictureFacts>(prefer: readonly PreferKey[], tie: (a: T, b: T) => number = (a, b) => a.at - b.at): (a: T, b: T) => number {
  return (a, b) => {
    for (const k of prefer) {
      const sa = SCORE[k](a);
      const sb = SCORE[k](b);
      if (sa === null || sb === null || sa === sb) continue;
      return sb - sa;
    }
    return tie(a, b);
  };
}

/** Bits that differ between two fingerprints. */
export const fingerprintDistance = (a: bigint, b: bigint): number => {
  let n = 0;
  for (let v = a ^ b; v; v &= v - 1n) n++;
  return n;
};
/** Two fingerprints this close are one look (Winnow's own duplicate threshold is 10 bits). */
export const ALIKE_BITS = 8;
/** Look-alikes are only looked for within this many seconds, in the same folder. */
export const ALIKE_SECONDS = 10 * 60;

/** True when `c` looks like `k`: their fingerprints a few bits apart, in the same folder, a few minutes apart. */
export function looksAlike(c: PictureFacts, k: PictureFacts): boolean {
  return c.phash !== null && k.phash !== null && k.folder === c.folder && Math.abs(k.at - c.at) <= ALIKE_SECONDS && fingerprintDistance(k.phash, c.phash) <= ALIKE_BITS;
}
