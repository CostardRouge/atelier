/**
 * Trips' openers at the head of a recap (lab 7, then lab 16 — his «go» of
 * 2026-11-10): Virée, the Itinerary, Vitrine and the Trip card run UNCHANGED
 * out of Trips' registry (`hookVariantById`), each with the settings its own
 * panel wrote (`RecapOpener.options`), over the trip the recap keeps a copy
 * of (`recap-opener-trip.ts`).
 *
 * The TRIP gives the road, the legs, the vehicle and the way places are
 * written; the RECAP gives the stops — its shown pictures that carry a GPS,
 * in time order — and the stills they show. With no trip at all the recap is
 * its own: a trip of nothing over its days, so two located pictures are a
 * road as the crow flies and the default vehicle drives it (lab 16, Q1).
 *
 * The context is the one Trips builds (`hookContextFor`) for a piece dated on
 * the recap's last day that no other piece is — so the calendar is the
 * trip's, untouched.
 *
 * What was fixed before lab 16 (eight stops, 0.45 s a picture, no summary
 * card; twelve stops, the map a size up on its plate) is where a variant
 * STARTS here (`RECAP_START`, `MAX_STOPS`): every one of them is his to
 * change in the variant's own panel.
 *
 * Pure but for the variants' own `ready` (fonts, a map ground asked for).
 */

import { REVEAL_SECONDS } from '../roadtrip/hooks/drive-plan';
import { hookContextFor } from '../roadtrip/hooks/hook-context';
import { hookVariantById } from '../roadtrip/hooks/registry';
import { sampleEvenly } from '../roadtrip/hooks/picked';
import { readStopSource, sourceStops } from '../roadtrip/hooks/stop-source';
import type { HookContext, HookOptions, HookPicture, HookPickedPicture, HookRender, HookVariant } from '../roadtrip/hooks/hook-variant';
import type { TripDoc, TripPost } from '../roadtrip/trip-types';
import type { RecapPicture } from './recap-doc';
import type { RecapOpener, TripOpenerKind } from './recap-opener';
import { TRIP_OPENERS } from './recap-opener';
import { blankTrip, isGivenTrip, tripOf, tripOverlap } from './recap-opener-trip';
import type { Drawable } from './recap-paint';
import type { TripOpenerPlan } from './recap-opener-plan';

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** The trip whose days cover the most of `days` (one at least), else null. */
export function tripCovering<T extends Pick<TripDoc, 'startDate' | 'endDate'>>(trips: readonly T[], days: readonly string[]): T | null {
  let best: T | null = null;
  let bestDays = 0;
  for (const t of trips) {
    const overlap = tripOverlap(t, days);
    if (overlap > bestDays) {
      best = t;
      bestDays = overlap;
    }
  }
  return best;
}

/** A recap picture as a picked picture of Trips: found again by its key (`id:<key>`), on its day, at its moment and place. */
export function pickedOf(p: RecapPicture): HookPickedPicture | null {
  if (!p.day) return null;
  return {
    ref: { name: p.name, size: 0, lastModified: 0, assetId: p.key },
    date: p.day,
    takenAt: dayMs(p.day) + (p.second !== undefined ? p.second * 1000 : (p.minute ?? 720) * 60_000),
    ...(p.lat !== undefined && p.lon !== undefined ? { coords: { lat: p.lat, lon: p.lon } } : {}),
  };
}

/**
 * The pictures a variant draws, read at the moment it paints: a recap picture
 * (`id:<key>`) from the painter's stills, anything else — a map ground the
 * variant asked the shell for — from `grounds`.
 */
class StillMap extends Map<string, HookPicture> {
  read: (key: string) => Drawable | null = () => null;
  grounds: ReadonlyMap<string, HookPicture> | null = null;
  override get(key: string): HookPicture | undefined {
    if (!key.startsWith('id:')) return this.grounds?.get(key);
    const d = this.read(key.slice(3));
    return d ? { image: d.image, width: d.width, height: d.height } : undefined;
  }
  override has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

/** Where each variant starts in a recap, over its own defaults: the cover follows, so no summary card and short halts; the map a size up on its plate. */
const RECAP_START: Record<TripOpenerKind, HookOptions> = {
  drive: { summary: false, secondsPerPicture: 0.45, includePieces: false },
  map: { size: 1.1, plate: true, includePieces: false },
  showcase: {},
  card: { includePieces: false },
};
/** How many of the recap's located pictures a variant starts on: an opener is the first seconds, not the trip again. */
const MAX_STOPS: Record<TripOpenerKind, number> = { drive: 8, map: 12, showcase: 0, card: 12 };
/** The Trip card rests this long once it is whole. */
const CARD_HOLD = 1.6;

export interface TripOpenerInput {
  kind: TripOpenerKind;
  opener: Pick<RecapOpener, 'options' | 'tripCopy'>;
  /** The recap's shown pictures. */
  pictures: readonly RecapPicture[];
  /** The recap's days. */
  days: readonly string[];
  /** Width / height of the page. */
  aspect: number;
  /** The recap's title — what a recap with no trip is called on a card. */
  title?: string;
  /** The picture under the Trip card (a pool key): the recap's best. */
  best?: string | null;
}

/** A variant made ready to be planned, painted and edited: what its panel is handed too. */
export interface TripOpenerSetup {
  kind: TripOpenerKind;
  variant: HookVariant;
  /** The trip driven: the recap's copy, else a trip of nothing over its days. */
  trip: TripDoc;
  /** A trip was given (a copy that reads) — false on the recap's own. */
  hasTrip: boolean;
  /** The day the piece that is no piece is dated: the recap's last, inside the trip. */
  day: string;
  ctx: HookContext;
  /** The settings in effect: the variant's defaults, Recap's start, what was stored, and the stops. */
  options: HookOptions;
  /** The recap's located pictures inside the trip, in time order — what a stop may be. */
  located: HookPickedPicture[];
  /** The stops the recap gives by itself, when the author chose none. */
  auto: { picked: HookPickedPicture[]; stopsOn: 'pictures' | 'places' };
  best: string | null;
  stills: StillMap;
}

let BLANK: { key: string; trip: TripDoc } | null = null;
/** The recap's own trip of nothing, the same object while its name and span hold (a context is memoised on it). */
function ownTrip(title: string, days: readonly string[]): TripDoc {
  const sorted = [...days].sort();
  const key = `${title}|${sorted[0] ?? ''}|${sorted[sorted.length - 1] ?? ''}`;
  if (BLANK?.key !== key) BLANK = { key, trip: blankTrip(title, sorted) };
  return BLANK.trip;
}

const keyOf = (p: HookPickedPicture) => p.ref.assetId ?? '';
const sameKeys = (a: readonly HookPickedPicture[], b: readonly HookPickedPicture[]) => a.length === b.length && a.every((p, i) => keyOf(p) === keyOf(b[i]));

/** Make `input.kind` ready over the recap; null when this build has no such variant or the recap has no day. */
export function setupTripOpener(input: TripOpenerInput): TripOpenerSetup | null {
  const variant = hookVariantById(input.kind);
  const days = [...input.days].sort();
  if (!variant || !days.length) return null;
  const copy = input.opener.tripCopy ? tripOf(input.opener.tripCopy) : null;
  const trip = copy ?? ownTrip(input.title ?? '', days);
  const lastDay = days[days.length - 1];
  const day = lastDay < trip.startDate ? trip.startDate : lastDay > trip.endDate ? trip.endDate : lastDay;
  const located = input.pictures
    .filter((p) => p.day && p.day >= trip.startDate && p.day <= trip.endDate)
    .flatMap((p) => {
      const k = pickedOf(p);
      return k?.coords ? [k] : [];
    });
  const stored = input.opener.options[input.kind];
  // His own choice of pictures wins while it still names pictures of the recap; else the recap's located ones, evenly thinned.
  const byKey = new Map(located.map((p) => [keyOf(p), p]));
  const chosen = Array.isArray(stored?.picked) ? (stored.picked as HookPickedPicture[]).flatMap((p) => byKey.get(p?.ref?.assetId ?? '') ?? []) : [];
  const auto = { picked: sampleEvenly(located, MAX_STOPS[input.kind]), stopsOn: located.length >= 2 ? ('pictures' as const) : ('places' as const) };
  const options: HookOptions = {
    ...variant.defaults,
    ...RECAP_START[input.kind],
    stopsOn: auto.stopsOn,
    ...(stored ?? {}),
    picked: chosen.length ? chosen : auto.picked,
  };
  const stills = new StillMap();
  // A piece of the trip that is no other: its day the recap's last, its timing the opener's own.
  const post = { id: '__recap__', date: day, badge: { durationSeconds: 4, mode: 'day' } } as unknown as TripPost;
  const ctx = hookContextFor(trip, post, input.aspect, null, stills, { durationSeconds: 6, screenSeconds: 6 });
  return { kind: input.kind, variant, trip, hasTrip: Boolean(copy) && isGivenTrip(input.opener.tripCopy), day, ctx, options, located, auto, best: input.best ?? null, stills };
}

/**
 * What a panel's change is KEPT as: the options it wrote, minus the stops the
 * recap gives by itself — so a recap whose pictures change keeps following
 * them until the author chooses his own.
 */
export function storedOptions(setup: Pick<TripOpenerSetup, 'auto'>, next: HookOptions): HookOptions {
  const { picked, stopsOn, ...rest } = next as Record<string, unknown>;
  const own = Array.isArray(picked) && !sameKeys(picked as HookPickedPicture[], setup.auto.picked);
  return { ...rest, ...(stopsOn !== undefined && stopsOn !== setup.auto.stopsOn ? { stopsOn } : {}), ...(own ? { picked } : {}) };
}

/** Why the variant cannot open this recap, or null — what its tile says when it is refused. */
export function tripOpenerUnmet(setup: TripOpenerSetup): string | null {
  const own = setup.variant.unmet?.(setup.ctx);
  if (own) return own;
  if (setup.kind === 'showcase') return null;
  const stops = sourceStops(readStopSource(setup.options, 'places'), setup.ctx);
  if (stops.length >= 2) return null;
  return setup.hasTrip ? 'This trip has fewer than two located places over these days' : 'Choose a trip, or give the recap two located pictures';
}

/** The setup's opener as the film plays it; null when it plays nothing. */
export function planTripOpener(setup: TripOpenerSetup): TripOpenerPlan | null {
  if (tripOpenerUnmet(setup)) return null;
  const { kind, variant, stills } = setup;
  let render: HookRender;
  try {
    render = variant.prepare(setup.options, setup.ctx);
  } catch {
    return null;
  }
  if (!render.paint) return null;
  // The card counts up or is whole at once, then rests; the others play their own length.
  const own = Math.max(0, render.seconds);
  const seconds = kind === 'card' ? own + CARD_HOLD : own;
  if (!(seconds > 0)) return null;
  const paint = render.paint.bind(render);
  const picked = (setup.options.picked as HookPickedPicture[] | undefined) ?? [];
  const best = kind === 'card' ? setup.best : null;
  return {
    kind,
    seconds: Math.max(1, seconds),
    keys: [...(setup.options.stopsOn === 'custom' ? [] : picked.map(keyOf)), ...(best ? [best] : [])].filter(Boolean),
    paint(g, w, h, t, read) {
      stills.read = read ?? (() => null);
      // A frame of ink under it: the variants own the frame but may leave its edges.
      g.fillStyle = '#141210';
      g.fillRect(0, 0, w, h);
      // The Trip card is a layer over «the slide's own picture»: here, the recap's best.
      const under = best ? stills.read(best) : null;
      if (under) coverDraw(g, under, w, h);
      paint(g, Math.min(t, own > 0 ? own : seconds), { width: w, height: h });
    },
    ...(render.ready ? { ready: () => render.ready!(0, own) } : {}),
    wantsGround: () => variant.wantsBasemap?.(setup.options, setup.ctx) ?? [],
    setGrounds(grounds) {
      stills.grounds = grounds;
    },
    tripName: setup.hasTrip ? setup.trip.name : null,
    // A Virée that reveals what follows (no summary card to rest on) fades its map off over its last moments.
    rest: Math.max(0, kind === 'drive' && setup.options.end !== 'stay' && setup.options.summary === false ? own - REVEAL_SECONDS - 0.05 : Math.max(1, seconds) - 0.01),
  };
}

function coverDraw(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, d: Drawable, w: number, h: number): void {
  if (!(d.width > 0) || !(d.height > 0)) return;
  const k = Math.max(w / d.width, h / d.height);
  const dw = d.width * k;
  const dh = d.height * k;
  g.drawImage(d.image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * The settings of a variant that are its LOOK — what a kept style carries to
 * another recap — without what was given to this one (`contentKeys`: the
 * stops, the pictures, a card's words).
 */
export function lookOptions(options: RecapOpener['options']): RecapOpener['options'] {
  const out: RecapOpener['options'] = {};
  for (const kind of TRIP_OPENERS) {
    const o = options[kind];
    if (!o) continue;
    const content = new Set(hookVariantById(kind)?.contentKeys ?? []);
    out[kind] = Object.fromEntries(Object.entries(o).filter(([k]) => !content.has(k)));
  }
  return out;
}

/** A style's looks laid over a recap's own options: the look changes, what was given to this recap stays. */
export function withLookOptions(own: RecapOpener['options'], looks: RecapOpener['options'] | undefined): RecapOpener['options'] {
  if (!looks) return own;
  const out: RecapOpener['options'] = { ...own };
  for (const kind of TRIP_OPENERS) {
    const look = looks[kind];
    if (!look) continue;
    const content = new Set(hookVariantById(kind)?.contentKeys ?? []);
    const kept = Object.fromEntries(Object.entries(own[kind] ?? {}).filter(([k]) => content.has(k)));
    out[kind] = { ...look, ...kept };
  }
  return out;
}
