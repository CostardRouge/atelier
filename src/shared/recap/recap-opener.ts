/**
 * A recap's OPENER (lab 7, his yes of 2026-11-06): the first seconds of its
 * Reel, before its own first page — Trips' openers brought to a recap.
 *
 * - **Défilé**: the recap's pictures flick by, faster and faster, on Trips'
 *   own curves (`easing.ts`) and over its tape (`paintTape`), then the cover.
 * - **Badge**: one picture full screen, slowly pushed in, with a block that
 *   names its day, its place and its camera — then the cover.
 * - **Virée** and **Itinerary** (`drive`, `map`): a trip's road, offered only
 *   when a trip of Trips covers the recap's days (`recap-trip-opener.ts`).
 *
 * The opener LEADS the film: `planFilm` shifts every page by its seconds, so
 * the clips, the sound and the stage's clock read one timeline. The author's
 * length counts it. On a carousel, a Badge (or a trip opener) may also be the
 * FIRST slide — its last frame, a still.
 *
 * The model (this file, read by `readRecapDoc`) and the plans
 * (`recap-opener-plan.ts`) are apart so the document imports no plan.
 *
 * Pure and DOM-free.
 */

import { EASING_IDS, type HookEasing } from '../roadtrip/hooks/easing';

export type OpenerKind = 'none' | 'defile' | 'badge' | 'drive' | 'map';
export const OPENER_KINDS: readonly OpenerKind[] = ['none', 'defile', 'badge', 'drive', 'map'];
/** The openers that need a trip of Trips over the recap's days. */
export const TRIP_OPENERS: readonly OpenerKind[] = ['drive', 'map'];

export const OPENER_LABEL: Record<OpenerKind, string> = {
  none: 'None',
  defile: 'Défilé',
  badge: 'Badge',
  drive: 'Virée',
  map: 'Itinerary',
};

export const OPENER_HINT: Record<OpenerKind, string> = {
  none: 'The recap starts on its own first page',
  defile: 'Its pictures flick by, faster and faster, then the cover',
  badge: 'One picture, its day, its place and its camera, then the cover',
  drive: "The drive along the trip's road over these days, then the cover",
  map: "The trip's map, its stops lit one by one, then the cover",
};

/** Which lines the Badge says. */
export interface BadgeLines {
  date: boolean;
  place: boolean;
  camera: boolean;
}

export interface RecapOpener {
  kind: OpenerKind;
  /** Défilé: how long the sweep runs; Badge: how long the picture holds; a trip opener: how long it plays. */
  seconds: number;
  /** Défilé: how the head travels (Trips' curves). */
  easing: HookEasing;
  /** Défilé: the tape of the period's days under the pictures. */
  tape: boolean;
  /** Défilé: a tick at every landing, mixed under the sound. */
  ticks: boolean;
  /** Badge: the picture, by key; null = the recap's best. */
  picture: string | null;
  /** Badge: its lines. */
  lines: BadgeLines;
  /** Badge: the big line, when the author wrote one; null = the place, else the recap's title. */
  title: string | null;
  /** Badge or a trip opener: also the carousel's first slide (its last frame). */
  slide: boolean;
  /** A trip opener: the trip, by id; null = the one covering the recap's days. */
  trip: string | null;
}

export const OPENER_SECONDS = { min: 0.6, max: 8 } as const;
const DEFAULT_SECONDS: Record<OpenerKind, number> = { none: 0, defile: 1.8, badge: 2.4, drive: 4, map: 4 };

export const DEFAULT_OPENER: RecapOpener = {
  kind: 'none',
  seconds: DEFAULT_SECONDS.defile,
  easing: 'ease-out',
  tape: true,
  ticks: true,
  picture: null,
  lines: { date: true, place: true, camera: true },
  title: null,
  slide: false,
  trip: null,
};

/** The seconds a kind starts on when it is chosen. */
export const openerSecondsFor = (kind: OpenerKind) => DEFAULT_SECONDS[kind];

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** The opener read from anything: an unknown kind is none, every number clamped. */
export function readOpener(raw: unknown): RecapOpener {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_OPENER, lines: { ...DEFAULT_OPENER.lines } };
  const r = raw as Record<string, unknown>;
  const kind = OPENER_KINDS.includes(r.kind as OpenerKind) ? (r.kind as OpenerKind) : 'none';
  const l = r.lines && typeof r.lines === 'object' ? (r.lines as Record<string, unknown>) : {};
  const title = typeof r.title === 'string' ? r.title.slice(0, 120) : null;
  return {
    kind,
    seconds: num(r.seconds, OPENER_SECONDS.min, OPENER_SECONDS.max, DEFAULT_SECONDS[kind] || DEFAULT_OPENER.seconds),
    easing: (EASING_IDS as readonly string[]).includes(r.easing as string) ? (r.easing as HookEasing) : 'ease-out',
    tape: r.tape !== false,
    ticks: r.ticks !== false,
    picture: typeof r.picture === 'string' && r.picture ? r.picture.slice(0, 600) : null,
    lines: { date: l.date !== false, place: l.place !== false, camera: l.camera !== false },
    title: title && title.trim() ? title : null,
    slide: r.slide === true,
    trip: typeof r.trip === 'string' && r.trip ? r.trip.slice(0, 200) : null,
  };
}
