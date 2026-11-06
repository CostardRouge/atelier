/**
 * The clips a recap's BACKGROUND may loop, as the clip drawer offers them,
 * and the loop's band over a clip — his asks of 2026-11-05: a drawer of
 * thumbnails with their lengths, Live Photos as short clips marked apart and
 * shown last, the recap's own days first; a loop set by two handles AND by
 * dragging the band whole.
 *
 * Pure and DOM-free.
 */

import { winnowKey, type RecapBackground, type RecapDoc, type RecapPicture } from './recap-doc';
import { templateDays } from './recap-slots';

/** A Live Photo's motion is about three seconds; a local `.mov` this short beside its still reads as one. */
export const LIVE_MAX_SECONDS = 4;

export interface ClipChoice {
  /** The background's `video` once chosen. */
  key: string;
  /** What the tile draws and plays: a clip of the pool, or the clip a Live Photo still would become. */
  clip: RecapPicture;
  live: boolean;
  /** Seconds, when known. */
  duration: number | null;
  /** Taller than wide. */
  portrait: boolean;
  /** Not yet in the pool: choosing it adds `clip` as a loose clip. */
  added: boolean;
  /** A Live Photo's still, whose picture the tile shows (its motion may have none yet). */
  still?: RecapPicture;
}

export interface ClipGroups {
  /** The recap's own days — its clips first, then its Live Photos. */
  days: ClipChoice[];
  /** Clips kept for this recap only (added as a background, never a cell's). */
  kept: ClipChoice[];
  /** The pool's other clips, outside the recap's days. */
  elsewhere: ClipChoice[];
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase();

/** The loose clip a Live Photo still becomes when its motion is chosen. */
export function liveClipOf(photo: RecapPicture): RecapPicture | null {
  if (photo.origin !== 'winnow' || photo.motion === undefined || !photo.instance || photo.asset === undefined) return null;
  return {
    key: winnowKey(photo.instance, photo.motion),
    origin: 'winnow',
    instance: photo.instance,
    asset: photo.motion,
    name: `${photo.name.replace(/\.[^.]+$/, '')}.MOV`,
    kind: 'video',
    day: photo.day,
    ...(photo.minute !== undefined ? { minute: photo.minute } : {}),
    ...(photo.device ? { device: photo.device } : {}),
    ...(photo.width ? { width: photo.width } : {}),
    ...(photo.height ? { height: photo.height } : {}),
    loose: true,
    liveStill: photo.asset,
  };
}

/** True for a Live Photo's motion: marked so by Winnow's pairing, or a short local `.mov` beside a still of its name. */
export function isLiveClip(clip: RecapPicture, stills: ReadonlySet<string>): boolean {
  if (clip.kind !== 'video') return false;
  if (clip.liveStill !== undefined) return true;
  return /\.mov$/i.test(clip.name) && (clip.duration ?? Infinity) <= LIVE_MAX_SECONDS && stills.has(stem(clip.name));
}

const byMoment = (a: RecapPicture, b: RecapPicture) => (a.day ?? '').localeCompare(b.day ?? '') || (a.minute ?? 0) - (b.minute ?? 0) || a.name.localeCompare(b.name);

/** Every clip the background may loop, grouped as the drawer shows them. */
export function backgroundChoices(doc: RecapDoc): ClipGroups {
  const days = new Set(templateDays(doc));
  const photos = doc.pictures.filter((p) => p.kind === 'photo');
  const stills = new Set(photos.map((p) => stem(p.name)));
  const keys = new Set(doc.pictures.map((p) => p.key));
  const choice = (clip: RecapPicture, added = false, still?: RecapPicture): ClipChoice => {
    const live = isLiveClip(clip, stills);
    const its = still ?? (live && clip.liveStill === undefined ? photos.find((p) => stem(p.name) === stem(clip.name)) : undefined);
    return {
      key: clip.key,
      clip,
      live,
      duration: clip.duration ?? null,
      portrait: Boolean(clip.width && clip.height && clip.height > clip.width),
      added,
      ...(its ? { still: its } : {}),
    };
  };
  const clips = doc.pictures.filter((p) => p.kind === 'video').sort(byMoment);
  const inDays = clips.filter((p) => !p.loose && p.day !== null && days.has(p.day)).map((p) => choice(p));
  // A Live Photo still of the days whose motion is not in the pool yet: offered as the clip it would become.
  const lives = doc.pictures
    .filter((p) => p.kind === 'photo' && !p.loose && p.day !== null && days.has(p.day))
    .sort(byMoment)
    .flatMap((p) => {
      const c = liveClipOf(p);
      return c && !keys.has(c.key) ? [choice(c, true, p)] : [];
    });
  const all = [...inDays, ...lives];
  return {
    // Live Photos last (the lab's default): a clip is what a background usually wants.
    days: [...all.filter((c) => !c.live), ...all.filter((c) => c.live)],
    kept: clips.filter((p) => p.loose).map((p) => choice(p)),
    elsewhere: clips.filter((p) => !p.loose && (p.day === null || !days.has(p.day))).map((p) => choice(p)),
  };
}

// ---- the loop's band ----------------------------------------------------------------

/** The shortest loop the handles allow, seconds. */
export const MIN_LOOP = 0.3;

/** The loop as it plays over a clip of `length` seconds: `[a, b]`. */
export function loopBand(bg: Pick<RecapBackground, 'loopIn' | 'loopOut'>, length: number): { a: number; b: number } {
  const L = Math.max(MIN_LOOP, length);
  const a = Math.min(Math.max(0, bg.loopIn), L - MIN_LOOP);
  const b = Math.max(a + MIN_LOOP, bg.loopOut === null ? L : Math.min(bg.loopOut, L));
  return { a, b };
}

/** What a band `[a, b]` stores: an out at the clip's end is «its end» (null), so a longer proxy still loops whole. */
function stored(a: number, b: number, L: number): Pick<RecapBackground, 'loopIn' | 'loopOut'> {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { loopIn: r(a), loopOut: b >= L - 0.01 ? null : r(b) };
}

/** The band dragged WHOLE by `delta` seconds: its length kept, held inside the clip. */
export function dragBand(bg: Pick<RecapBackground, 'loopIn' | 'loopOut'>, length: number, delta: number): Pick<RecapBackground, 'loopIn' | 'loopOut'> {
  const { a, b } = loopBand(bg, length);
  const L = Math.max(MIN_LOOP, length);
  const span = b - a;
  const na = Math.min(Math.max(0, a + delta), L - span);
  return stored(na, na + span, L);
}

/** One handle moved to `at` seconds, the other where it is; never closer than `MIN_LOOP`. */
export function dragEdge(bg: Pick<RecapBackground, 'loopIn' | 'loopOut'>, length: number, edge: 'in' | 'out', at: number): Pick<RecapBackground, 'loopIn' | 'loopOut'> {
  const { a, b } = loopBand(bg, length);
  const L = Math.max(MIN_LOOP, length);
  if (edge === 'in') return stored(Math.min(Math.max(0, at), b - MIN_LOOP), b, L);
  return stored(a, Math.max(a + MIN_LOOP, Math.min(L, at)), L);
}
