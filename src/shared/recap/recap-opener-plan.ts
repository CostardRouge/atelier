/**
 * What an opener PLAYS: the Défilé's stops on Trips' curves, the Badge's
 * picture and lines, a trip opener's length and painter — planned once and
 * read by the painter (`recap-opener-paint.ts`), the film plan and the sound.
 *
 * Pure and DOM-free.
 */

import { EASINGS, type HookEasing } from '../roadtrip/hooks/easing';
import { sampleEvenly } from '../roadtrip/hooks/picked';
import { stopFraction } from '../roadtrip/hooks/scrub-plan';
import { TICK_KITS } from '../roadtrip/hooks/tick-kits';
import type { SoundEvent } from '../audio/sound-event';
import type { IsoDate } from '../roadtrip/trip-days';
import type { RecapDoc, RecapPicture } from './recap-doc';
import type { RecapOpener } from './recap-opener';
import { byTime, deviceLabel, fillText, templateDays, type DeviceAliases, type ResolvedRecap } from './recap-slots';
import { rankByRules } from './recap-carousel';

/** One picture the Défilé lands on. */
export interface DefileStop {
  key: string;
  /** Seconds into the opener at which the head lands here. */
  at: number;
  /** 1-based place on the tape: its day in the period, or its rank when the recap has no run of days. */
  dayNumber: number;
}

export interface DefilePlan {
  kind: 'defile';
  seconds: number;
  stops: DefileStop[];
  /** The tape's length, in days (or stops). */
  totalDays: number;
  delay: number;
  sweep: number;
  easing: HookEasing;
  tape: boolean;
  /** Which stop the head last reached at `t`. */
  stopAt(t: number): number;
  /** The fractional day under the head. */
  headDayAt(t: number): number;
  /** Seconds since the head last landed. */
  sinceStopAt(t: number): number;
}

export interface BadgePlan {
  kind: 'badge';
  seconds: number;
  /** The picture, or null when the recap has none. */
  key: string | null;
  /** The lines, as they read: a date line, the big line, the camera's. */
  date: string | null;
  title: string | null;
  camera: string | null;
}

/** A trip opener's own plan lives with Trips' engine; Recap only needs its length and its painter (`recap-trip-opener.ts`). */
export interface TripOpenerPlan {
  kind: 'drive' | 'map';
  seconds: number;
  /** Paints the opener's frame at `t` into a `w × h` page. */
  paint(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, t: number): void;
  /** The stills it draws (pool keys), for the painter's sources. */
  keys: string[];
}

export type OpenerPlan = DefilePlan | BadgePlan | TripOpenerPlan;

/** The most pictures a Défilé flicks through: past that, a flash is shorter than a frame. */
export const DEFILE_MAX_STOPS = 40;
/** How long the first picture holds before the head moves, and how long the last before the cover. */
const DEFILE_DELAY = 0.15;
const DEFILE_REST = 0.3;

/** The pictures a recap shows, once each, in the order they were taken. */
export function shownPictures(resolved: ResolvedRecap): RecapPicture[] {
  const seen = new Set<string>();
  const out: RecapPicture[] = [];
  for (const s of resolved.slots) if (s.picture && !seen.has(s.picture.key)) {
    seen.add(s.picture.key);
    out.push(s.picture);
  }
  return byTime(out);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The Défilé over a recap's shown pictures, on the tape of `days` (the recap's period). */
export function planDefile(opener: RecapOpener, pictures: readonly RecapPicture[], days: readonly IsoDate[]): DefilePlan | null {
  const list = sampleEvenly(byTime(pictures), DEFILE_MAX_STOPS);
  if (list.length < 2) return null;
  const sweep = Math.max(0.3, opener.seconds - DEFILE_DELAY - DEFILE_REST);
  const index = new Map([...new Set(days)].sort().map((d, i) => [d, i + 1]));
  // A run of days is a calendar the tape reads; a recap of scattered days (on this day) reads its pictures in turn.
  const onDays = days.length >= 2 && list.every((p) => p.day && index.has(p.day));
  const totalDays = onDays ? index.size : list.length;
  const stops: DefileStop[] = list.map((p, i) => ({
    key: p.key,
    at: DEFILE_DELAY + stopFraction(i, list.length, opener.easing) * sweep,
    dayNumber: onDays ? index.get(p.day!)! : i + 1,
  }));
  const n = stops.length;
  const progress = (t: number) => EASINGS[opener.easing].ease(clamp01((t - DEFILE_DELAY) / sweep)) * (n - 1);
  const stopAt = (t: number) => {
    let k = 0;
    for (let i = n - 1; i >= 0; i--) if (t >= stops[i].at - 1e-9) {
      k = i;
      break;
    }
    return k;
  };
  return {
    kind: 'defile',
    seconds: DEFILE_DELAY + sweep + DEFILE_REST,
    stops,
    totalDays,
    delay: DEFILE_DELAY,
    sweep,
    easing: opener.easing,
    tape: opener.tape,
    stopAt,
    headDayAt(t) {
      const p = progress(t);
      const i = Math.min(n - 2, Math.floor(p));
      const f = p - i;
      return stops[i].dayNumber + (stops[i + 1].dayNumber - stops[i].dayNumber) * f;
    },
    sinceStopAt(t) {
      return t - stops[stopAt(t)].at;
    },
  };
}

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** `SAT 12 OCT 2026` — the badge's date line. */
export function badgeDate(day: IsoDate): string {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[wd]} ${d} ${MONTH[m - 1]} ${y}`;
}

/** `Esperance, Western Australia` — the place as the badge says it: the most local name, then its region. */
export function placeLine(p: Pick<RecapPicture, 'place' | 'region' | 'country'>): string | null {
  if (!p.place) return p.region ?? p.country ?? null;
  return p.region && p.region !== p.place ? `${p.place}, ${p.region}` : p.place;
}

/** The Badge over a recap: its picture (the author's, else the best shown), its lines read off the picture. */
export function planBadge(
  opener: RecapOpener,
  doc: Pick<RecapDoc, 'pictures' | 'carousel'>,
  shown: readonly RecapPicture[],
  cameraOf: (p: RecapPicture) => string | null,
  fallbackTitle: string,
): BadgePlan {
  const own = opener.picture ? doc.pictures.find((p) => p.key === opener.picture && !p.loose) : undefined;
  const picture = own ?? rankByRules(doc.carousel.rules.prefer)(shown.filter((p) => p.kind === 'photo'))[0] ?? shown[0] ?? null;
  const place = picture ? placeLine(picture) : null;
  return {
    kind: 'badge',
    seconds: opener.seconds,
    key: picture?.key ?? null,
    date: opener.lines.date && picture?.day ? badgeDate(picture.day) : null,
    title: opener.lines.place ? (opener.title ?? place ?? (fallbackTitle || null)) : opener.title,
    camera: opener.lines.camera && picture ? cameraOf(picture) : null,
  };
}

/**
 * The Badge's look at `t`: how far the picture is pushed in (1 → 1.06, eased)
 * and how far the block has come in (0 → 1 between 0.3 s and 0.9 s).
 */
export function badgeLook(plan: Pick<BadgePlan, 'seconds'>, t: number): { zoom: number; block: number } {
  const u = clamp01(t / Math.max(0.1, plan.seconds));
  const b = clamp01((t - 0.3) / 0.6);
  return { zoom: 1 + 0.06 * (u * (2 - u)), block: b * b * (3 - 2 * b) };
}

/** The ticks of a Défilé: one per landing, quieter as the head slows, the seat on the last (Trips' ratchet, as `scrubScore`). */
export function defileTicks(plan: DefilePlan, volume = 0.6): SoundEvent[] {
  const kit = TICK_KITS.ratchet;
  const n = plan.stops.length;
  return plan.stops.map((s, i) =>
    i === n - 1 ? { at: s.at, voice: kit.seat, gain: 0.8 * volume, rate: 1 } : { at: s.at, voice: kit.tick, gain: Math.max(0.35, 0.85 - i * 0.04) * volume, rate: 1 },
  );
}

/** The camera line of a badge: the device's own name for it, and the focal length. */
export function badgeCamera(p: RecapPicture, aliases: DeviceAliases = {}): string | null {
  if (!p.device) return null;
  const focal = p.focal ? ` · ${Math.round(p.focal)} mm` : '';
  return `${deviceLabel(p.device, aliases)}${focal}`;
}

/**
 * The opener a recap plays, or null: none chosen, a Défilé with fewer than two
 * pictures, or a trip opener with no trip (its plan is made beside Trips and
 * handed in as `trip`).
 */
export function planOpener(doc: RecapDoc, resolved: ResolvedRecap, aliases: DeviceAliases = {}, trip: OpenerPlan | null = null): OpenerPlan | null {
  const o = doc.opener;
  if (o.kind === 'none') return null;
  if (o.kind === 'drive' || o.kind === 'map') return trip && trip.kind === o.kind ? trip : null;
  const shown = shownPictures(resolved);
  if (o.kind === 'defile') return planDefile(o, shown, templateDays(doc).length ? templateDays(doc) : dayRun(shown));
  return planBadge(o, doc, shown, (p) => badgeCamera(p, aliases), fillText(doc.heading.text, resolved.vars));
}

/** The days from the first picture's to the last's, for a recap without days of its own (a grid over the whole pool). */
function dayRun(pictures: readonly RecapPicture[]): IsoDate[] {
  const days = pictures.flatMap((p) => (p.day ? [p.day] : [])).sort();
  if (days.length < 2) return [];
  const out: IsoDate[] = [];
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  for (let t = Date.parse(`${days[0]}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10) as IsoDate);
  return out;
}
