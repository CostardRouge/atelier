/**
 * The recap's SUMMARY CARD, as a model (2026-10-08, the lab «la carte récap»,
 * https://claude.ai/artifact/5rCRZCwpbsywuVaXfZrKGY): which face it wears,
 * which LOOK, which ground, which facts and which names — and those facts
 * MEASURED off the drive, so the card says exactly what the video counted.
 *
 * Six faces: the TRACE (the trip's road drawn big, the default of a new
 * recap), the TICKET (its barcode the ribbon of days), the PASSPORT (a stamp
 * per state crossed), the contact SHEET (the road's pictures and the road),
 * the STAMP (the card of before, in the map's box — what a recap saved
 * before the card was configurable keeps) and the DASHBOARD (an odometer
 * and the day gauge).
 *
 * Pure: the painter is `summary-paint.ts`. Nothing here is fetched: the
 * names grouped by town read the shipped index when the session has it, else
 * the first place of the group, never a blank.
 */

import type { TimeWindow } from '../../overlay/animation';
import type { StyleTheme } from '../../overlay/title-styles';
import { themeFromPreset } from '../../overlay/title-styles';
import type { DrivePlan, DriveStop } from './drive-plan';
import { formatDistance, type DistanceUnit } from './geo';
import type { PlaceWritingTrip } from '../place-style';
import { passportStamps, stopStates, type CardStamp } from './passport-stamps';
import { groupName, groupStops, type NamedTown } from './stop-clusters';

// --- the options -------------------------------------------------------------

export type CardFace = 'trace' | 'ticket' | 'passport' | 'sheet' | 'stamp' | 'dash';
/** In the order the picker shows them — his favourites first after the default. */
export const CARD_FACES: readonly CardFace[] = ['trace', 'ticket', 'passport', 'sheet', 'stamp', 'dash'];
export const CARD_FACE_NAMES: Record<CardFace, string> = {
  trace: 'Trace',
  ticket: 'Ticket',
  passport: 'Passport',
  sheet: 'Contact sheet',
  stamp: 'Stamp',
  dash: 'Dashboard',
};

export type CardFact = 'days' | 'distance' | 'places' | 'states' | 'photos' | 'longest';
export const CARD_FACTS: readonly CardFact[] = ['days', 'distance', 'places', 'states', 'photos', 'longest'];
export const CARD_FACT_NAMES: Record<CardFact, string> = {
  days: 'Days',
  distance: 'Distance',
  places: 'Places',
  states: 'States',
  photos: 'Photos',
  longest: 'Longest stay',
};
/** The most facts a card says. */
export const MAX_CARD_FACTS = 4;

/** What is under the card: the trip's last picture veiled, the look's own solid, or the map's paper. */
export type CardGround = 'photo' | 'solid' | 'paper';
/** Which places the road's faces name. */
export type CardLabels = 'none' | 'ends' | 'groups' | 'all' | 'chosen';
/** What names a group of places: the biggest town of the index near it, the longest stay, the first. */
export type CardLabelName = 'town' | 'stay' | 'first';
/** The numbers count up as the card comes, or are there at once. */
export type CardEntrance = 'count' | 'cut';
/**
 * When the BADGE is on screen, the card being there at the end: the badge and
 * the card are never on screen together. `auto` is `during` — the counter
 * follows the car, which is the only time there is a card.
 */
export type BadgeWhen = 'auto' | 'before' | 'during' | 'end' | 'never';

export interface CardOptions {
  cardFace: CardFace;
  /** `trip` (the trip's theme) or a preset id — for the card alone, never the badge. */
  cardLook: string;
  cardFacts: CardFact[];
  cardGround: CardGround;
  /** Empty: the trip's name. */
  cardTitle: string;
  /** Empty: «the recap». */
  cardSubtitle: string;
  cardLabels: CardLabels;
  cardLabelKm: number;
  cardLabelName: CardLabelName;
  /** The places named on `chosen`, by name. */
  cardChosen: string[];
  cardEntrance: CardEntrance;
  /** The ticket's three-letter codes; empty derives them from the names. */
  cardFrom: string;
  cardTo: string;
  badgeWhen: BadgeWhen;
  // --- the passport's stamps (`passport-stamps.ts`, 2026-10-09) ---
  /** What the stamps tell: the state, else the place (`mixed`); the states alone; the places alone. */
  cardStampMode: StampMode;
  /** A missing state read from the shipped town index at render, or left missing. */
  cardStampFill: 'index' | 'none';
  /** A state written as its code (QLD) or in full. */
  cardStampState: 'code' | 'full';
  /** A place with no state written as three letters, in full, or given no stamp. */
  cardStampPlace: 'code' | 'full' | 'skip';
  /** A destination stamped once, or at each visit in the road's order. */
  cardStampOnce: 'once' | 'visit';
}

/** What the passport's stamps tell. */
export type StampMode = 'mixed' | 'states' | 'places';

/**
 * What a stored recap reads when it says nothing — the STAMP, as it was. A
 * NEW Virée writes `cardFace: 'trace'` (`NEW_CARD`), his default.
 */
export const CARD_DEFAULTS: CardOptions = {
  cardFace: 'stamp',
  cardLook: 'trip',
  cardFacts: ['days', 'distance', 'places'],
  cardGround: 'photo',
  cardTitle: '',
  cardSubtitle: '',
  cardLabels: 'groups',
  cardLabelKm: 200,
  cardLabelName: 'town',
  cardChosen: [],
  cardEntrance: 'count',
  cardFrom: '',
  cardTo: '',
  badgeWhen: 'auto',
  cardStampMode: 'mixed',
  cardStampFill: 'index',
  cardStampState: 'code',
  cardStampPlace: 'code',
  cardStampOnce: 'once',
};

/** What a new Virée layer starts from, over `CARD_DEFAULTS`. */
export const NEW_CARD: Partial<CardOptions> = { cardFace: 'trace' };

export const CARD_LIMITS = { cardLabelKm: { min: 10, max: 1000 } } as const;
/** The subtitle a card says when the author wrote none. */
export const DEFAULT_SUBTITLE = 'The recap';

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback;
}

function text(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** The card's options in a stored record, read through the defaults. */
export function readCardOptions(raw: Readonly<Record<string, unknown>>): CardOptions {
  const d = CARD_DEFAULTS;
  const facts = Array.isArray(raw.cardFacts)
    ? [...new Set(raw.cardFacts.filter((f): f is CardFact => CARD_FACTS.includes(f as CardFact)))].slice(0, MAX_CARD_FACTS)
    : [...d.cardFacts];
  const km = Number(raw.cardLabelKm);
  const look = typeof raw.cardLook === 'string' && (raw.cardLook === 'trip' || themeFromPreset(raw.cardLook)) ? raw.cardLook : d.cardLook;
  return {
    cardFace: oneOf(raw.cardFace, CARD_FACES, d.cardFace),
    cardLook: look,
    cardFacts: facts,
    cardGround: oneOf(raw.cardGround, ['photo', 'solid', 'paper'], d.cardGround),
    cardTitle: text(raw.cardTitle),
    cardSubtitle: text(raw.cardSubtitle),
    cardLabels: oneOf(raw.cardLabels, ['none', 'ends', 'groups', 'all', 'chosen'], d.cardLabels),
    cardLabelKm: Number.isFinite(km) ? Math.min(CARD_LIMITS.cardLabelKm.max, Math.max(CARD_LIMITS.cardLabelKm.min, km)) : d.cardLabelKm,
    cardLabelName: oneOf(raw.cardLabelName, ['town', 'stay', 'first'], d.cardLabelName),
    cardChosen: Array.isArray(raw.cardChosen) ? raw.cardChosen.filter((n): n is string => typeof n === 'string' && !!n.trim()).slice(0, 60) : [],
    cardEntrance: oneOf(raw.cardEntrance, ['count', 'cut'], d.cardEntrance),
    cardFrom: cityCodeText(raw.cardFrom),
    cardTo: cityCodeText(raw.cardTo),
    badgeWhen: oneOf(raw.badgeWhen, ['auto', 'before', 'during', 'end', 'never'], d.badgeWhen),
    cardStampMode: oneOf(raw.cardStampMode, ['mixed', 'states', 'places'], d.cardStampMode),
    cardStampFill: oneOf(raw.cardStampFill, ['index', 'none'], d.cardStampFill),
    cardStampState: oneOf(raw.cardStampState, ['code', 'full'], d.cardStampState),
    cardStampPlace: oneOf(raw.cardStampPlace, ['code', 'full', 'skip'], d.cardStampPlace),
    cardStampOnce: oneOf(raw.cardStampOnce, ['once', 'visit'], d.cardStampOnce),
  };
}

function cityCodeText(value: unknown): string {
  return text(value, 4).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
}

/** Whether these opener layers' cards name groups by TOWN — the index must then be read. */
export function cardWantsTowns(options: Readonly<Record<string, unknown>>): boolean {
  if (options.summary === false) return false;
  const card = readCardOptions(options);
  if (card.cardFace === 'passport') return card.cardStampMode !== 'places' && card.cardStampFill === 'index';
  return card.cardLabels === 'groups' && card.cardLabelName === 'town' && (card.cardFace === 'trace' || card.cardFace === 'ticket');
}

// --- the badge and the card ----------------------------------------------------

/** When the badge shows, `auto` resolved. */
export type BadgeMoment = Exclude<BadgeWhen, 'auto'>;

export function badgeMoment(when: BadgeWhen): BadgeMoment {
  return when === 'auto' ? 'during' : when;
}

/** Seconds the car waits at the start for a badge shown BEFORE the drive. */
export const BADGE_BEFORE_SECONDS = 2.5;

/**
 * The badge's window on a recap that has its card (`HookRender.badgeWindow`):
 * BEFORE the drive while the car waits for it, DURING the drive until the
 * card comes, at the END in the card's place — from where the map fades —,
 * or NEVER. The badge and the card are never on screen together.
 */
export function badgeWindowFor(
  moment: BadgeMoment,
  schedule: { summaryAt: number | null; revealAt: number; lead: number; total: number },
): TimeWindow {
  if (moment === 'before') return { start: 0, end: schedule.lead };
  if (moment === 'during') return { start: 0, end: schedule.summaryAt ?? schedule.total };
  if (moment === 'end') return { start: schedule.revealAt, end: null };
  return { start: 0, end: 0 };
}

// --- the look -----------------------------------------------------------------

/** The card's theme: the trip's, or the preset it overrides it with — the card alone. */
export function cardTheme(look: string, trip: StyleTheme | null | undefined): StyleTheme | null {
  if (look !== 'trip') {
    const preset = themeFromPreset(look);
    if (preset) return preset;
  }
  return trip ?? themeFromPreset('neutral');
}

export interface CardInk {
  /** The card's ground colour (the solid, the paper; under a photo the veil's base). */
  ground: string;
  /** The words' ink when it is NOT the look's own colour (paper, a solid of the look's colour). */
  ink?: string;
  /** The road, the dots, the rules: the look's colour. */
  accent: string;
  /** Faint lines, frames: the ink at a low alpha. */
  rule: string;
  /** A texture the look's solid wears. */
  texture: 'none' | 'grain' | 'scan';
}

/** How the card is inked on its ground, for its look. */
export function cardInk(ground: CardGround, theme: StyleTheme | null, paper: { paperColor: string; inkColor: string }): CardInk {
  const colour = theme?.style.color ?? '#ffffff';
  if (ground === 'paper') {
    return { ground: paper.paperColor, ink: paper.inkColor, accent: readableOnPaper(colour, paper.inkColor), rule: paper.inkColor, texture: 'none' };
  }
  const preset = theme?.presetId;
  if (ground === 'solid') {
    if (preset === 'or-cine') return { ground: '#15110b', accent: colour, rule: colour, texture: 'grain' };
    if (preset === 'pixel-crt') return { ground: '#090c09', accent: colour, rule: colour, texture: 'scan' };
    // A flat of the look's own colour: the words take the paper's white.
    if (preset === 'plein-cadre') return { ground: colour, ink: '#fff6ea', accent: '#fff6ea', rule: '#fff6ea', texture: 'none' };
    return { ground: '#20242a', accent: colour, rule: colour, texture: 'none' };
  }
  return { ground: '#0d0c0a', accent: colour, rule: colour, texture: 'none' };
}

/** The look's colour where it reads on cream, else the map's ink — a white look on paper is invisible. */
function readableOnPaper(colour: string, ink: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  if (!m) return ink;
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.8 ? ink : colour;
}

// --- the facts -----------------------------------------------------------------

export interface CardFacts {
  /** The trip's days the drive covered, from the recap's clock; null where nothing dates it. */
  days: number | null;
  km: number;
  places: number;
  /** The states crossed, in the order first reached. */
  states: string[];
  photos: number;
  /** The longest stay on the clock: where, and how many days. */
  longest: { name: string; days: number } | null;
  first: string;
  last: string;
}

/** The facts of the drive, measured off its plan — the numbers the counter counted up to. */
export function cardFacts(plan: Pick<DrivePlan, 'route' | 'clock' | 'kmAtStop'>): CardFacts {
  const stops = plan.route.stops;
  const n = stops.length;
  const clock = plan.clock;
  const states: string[] = [];
  for (const stop of stops) for (const s of stop.states ?? []) if (s && !states.includes(s)) states.push(s);
  let longest: CardFacts['longest'] = null;
  if (clock) {
    stops.forEach((stop, i) => {
      const days = Math.round(clock.leave[i] - clock.arrive[i]);
      if (days >= 1 && (!longest || days > longest.days)) longest = { name: placeName(stop), days };
    });
  }
  return {
    days: clock && n ? Math.max(1, Math.round(clock.leave[n - 1] - clock.arrive[0])) : null,
    km: n ? plan.kmAtStop[n - 1] : 0,
    places: stops.reduce((sum, s) => sum + (s.members ?? 1), 0),
    states,
    photos: stops.reduce((sum, s) => sum + s.pictures.length, 0),
    longest,
    first: n ? placeName(stops[0]) : '',
    last: n ? placeName(stops[n - 1]) : '',
  };
}

/** A stop's own name, without the state the writing may add. */
export function placeName(stop: Pick<DriveStop, 'name' | 'place'>): string {
  return (stop.place ?? stop.name).trim();
}

export interface CardWords {
  day: string;
  days: string;
  stop: string;
  stops: string;
}

/** One fact as the card writes it: the number (counted up to), its text at rest, and its word. */
export interface CardCell {
  fact: CardFact;
  /** The number counted up to, or null for a fact that is a word. */
  value: number | null;
  text: string;
  word: string;
}

/**
 * The cells the card writes, in the author's order: a fact the drive cannot
 * measure (no clock for the days, no state known) is left out, never zero.
 */
export function cardCells(facts: CardFacts, keys: readonly CardFact[], words: CardWords, unit: DistanceUnit): CardCell[] {
  const u = unit === 'mi' ? 'mi' : 'km';
  const cells: CardCell[] = [];
  for (const fact of keys.slice(0, MAX_CARD_FACTS)) {
    if (fact === 'days' && facts.days !== null) {
      cells.push({ fact, value: facts.days, text: String(facts.days), word: (facts.days === 1 ? words.day : words.days).toLowerCase() });
    } else if (fact === 'distance') {
      const value = u === 'mi' ? facts.km * 0.621371 : facts.km;
      cells.push({ fact, value, text: numeral(facts.km, u), word: u });
    } else if (fact === 'places' && facts.places > 0) {
      cells.push({ fact, value: facts.places, text: String(facts.places), word: (facts.places === 1 ? words.stop : words.stops).toLowerCase() });
    } else if (fact === 'states' && facts.states.length > 0) {
      const k = facts.states.length;
      cells.push({ fact, value: k, text: String(k), word: k === 1 ? 'state' : 'states' });
    } else if (fact === 'photos' && facts.photos > 0) {
      cells.push({ fact, value: facts.photos, text: String(facts.photos), word: facts.photos === 1 ? 'photo' : 'photos' });
    } else if (fact === 'longest' && facts.longest) {
      cells.push({ fact, value: facts.longest.days, text: String(facts.longest.days), word: `${(facts.longest.days === 1 ? words.day : words.days).toLowerCase()} · ${facts.longest.name}` });
    }
  }
  return cells;
}

function numeral(km: number, unit: 'km' | 'mi'): string {
  return formatDistance(km, unit).replace(/\s*(km|mi)$/, '');
}

/** A cell's text at count-up progress `p` (0..1): its number eased up to the value, the text itself at 1. */
export function cellAt(cell: CardCell, p: number, unit: DistanceUnit): string {
  if (cell.value === null || p >= 1) return cell.text;
  const k = 1 - Math.pow(1 - Math.max(0, p), 3);
  const v = cell.value * k;
  if (cell.fact === 'distance') return numeral(unit === 'mi' ? v / 0.621371 : v, unit === 'mi' ? 'mi' : 'km');
  return String(Math.round(v));
}

// --- the names on the road ---------------------------------------------------------

export interface CardLabel {
  /** The stop the name is drawn at. */
  stop: number;
  name: string;
  /** Other places the name stands for («Cairns +2»). */
  more: number;
  /** Drawn first when two names collide: the ends, then the bigger groups. */
  rank: number;
}

/**
 * The places the road's faces name. `groups` folds the whole trip at the
 * card's own radius (`stop-clusters.ts`, every visit of a place one group —
 * the card sees the trip at once) and names each group once; `chosen` names
 * the places the author listed. The ends always rank first.
 */
export function cardLabels(
  plan: Pick<DrivePlan, 'route' | 'clock'>,
  card: Pick<CardOptions, 'cardLabels' | 'cardLabelKm' | 'cardLabelName' | 'cardChosen'>,
  towns: readonly NamedTown[] | null = null,
): CardLabel[] {
  const stops = plan.route.stops;
  const n = stops.length;
  if (!n || card.cardLabels === 'none') return [];
  const endRank = (i: number) => (i === 0 || i === n - 1 ? 0 : 1);
  const one = (i: number, rank = endRank(i)): CardLabel => ({ stop: i, name: placeName(stops[i]), more: (stops[i].members ?? 1) - 1, rank });
  if (card.cardLabels === 'ends') return n === 1 ? [one(0)] : [one(0), one(n - 1)];
  if (card.cardLabels === 'all') return stops.map((_, i) => one(i)).filter((l) => l.name);
  if (card.cardLabels === 'chosen') {
    const wanted = new Set(card.cardChosen.map((c) => c.trim().toLowerCase()));
    const seen = new Set<string>();
    return stops
      .map((_, i) => one(i))
      .filter((l) => {
        const key = l.name.toLowerCase();
        if (!wanted.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  const named = stops.map((s) => ({ lat: s.lat, lon: s.lon, name: placeName(s) }));
  const groups = groupStops(named, card.cardLabelKm, 'all');
  return groups
    .map((group): CardLabel => {
      const members = group.members.reduce((sum, i) => sum + (stops[i].members ?? 1), 0);
      let at = group.anchor;
      let name: string;
      if (card.cardLabelName === 'stay' && plan.clock && group.members.length > 1) {
        const clock = plan.clock;
        at = group.members.reduce((best, i) => (clock.leave[i] - clock.arrive[i] > clock.leave[best] - clock.arrive[best] ? i : best), group.members[0]);
        name = named[at].name;
      } else {
        name = groupName(named, group, card.cardLabelName === 'town' ? 'town' : 'first', towns);
        if (card.cardLabelName === 'first') at = group.members[0];
      }
      const ends = group.members.includes(0) || group.members.includes(n - 1);
      return { stop: at, name, more: members - 1, rank: ends ? 0 : 1 + 1 / Math.max(1, members) };
    })
    .filter((l) => l.name);
}

/** A label's text: the name, and how many places it also stands for. */
export function labelText(label: CardLabel): string {
  return label.more > 0 ? `${label.name} +${label.more}` : label.name;
}

/** The three letters a ticket prints for a place: its own, else the first three of its name. */
export function cityCode(name: string, own = ''): string {
  if (own) return own.slice(0, 3).toUpperCase();
  const letters = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return letters.slice(0, 3);
}

// --- the days ------------------------------------------------------------------------

export interface CardDay {
  day: number;
  /** A leg starts on it: the long tick. */
  legStart: boolean;
  /** A picture of the road was shot on it: the darker tick. */
  photo: boolean;
}

/** The trip's days as the ticket's barcode reads them: one tick each. */
export function cardDays(
  calendar: readonly { dayNumber: number; legStart: boolean }[],
  plan: Pick<DrivePlan, 'route'>,
): CardDay[] {
  const shot = new Set<number>();
  for (const stop of plan.route.stops) for (const p of stop.pictures) if (p.day !== undefined) shot.add(p.day);
  return calendar.map((d) => ({ day: d.dayNumber, legStart: d.legStart, photo: shot.has(d.dayNumber) }));
}

// --- the scene a face paints ------------------------------------------------------------

/** Everything a card face draws, prepared once with the plan. */
export interface CardScene {
  face: CardFace;
  card: CardOptions;
  theme: StyleTheme | null;
  ink: CardInk;
  plan: DrivePlan;
  unit: DistanceUnit;
  facts: CardFacts;
  cells: CardCell[];
  labels: CardLabel[];
  days: CardDay[];
  title: string;
  subtitle: string;
  /** The first and the last day of the drive, written («1 MAR 2025»), where the clock dates them. */
  from: string;
  to: string;
  /** The trip's length in days, for the dashboard's gauge. */
  tripDays: number;
  /** The vehicle's name, for the dashboard. */
  vehicle: string;
  /** The picture under a `photo` ground, keyed in the opener's pictures; null where the road has none. */
  groundPicture: string | null;
  /** The contact sheet's pictures, in the road's order. */
  sheet: string[];
  /** On a `photo` ground with no picture of the road, the slide's own picture is under the card: veil it. */
  below: boolean;
  /** The passport's stamps, in the road's order (`passport-stamps.ts`). */
  stamps: CardStamp[];
}

/** The most pictures the contact sheet prints. */
export const SHEET_PICTURES = 8;

export interface CardSceneInput {
  plan: DrivePlan;
  o: CardOptions & { distance: DistanceUnit; paperColor: string; inkColor: string };
  theme: StyleTheme | null | undefined;
  tripName: string | undefined;
  words: CardWords;
  calendar: readonly { date: string; dayNumber: number; legStart: boolean }[];
  towns: readonly NamedTown[] | null;
  vehicle: string;
  /** The slide's own picture is under the card (the card on a slide alone), so a photo ground has one. */
  below?: boolean;
  /** How the trip writes a state's code — the passport's stamps. */
  writing?: PlaceWritingTrip;
}

/** The card's scene for a recap: what each face reads, measured once. */
export function cardScene(input: CardSceneInput): CardScene {
  const { plan, o, calendar } = input;
  const theme = cardTheme(o.cardLook, input.theme);
  const unit: DistanceUnit = o.distance === 'mi' ? 'mi' : 'km';
  // The states each stop is in — its own, else the index's when asked — read
  // once: the passport stamps them and the «states» fact counts them.
  const fromIndex = o.cardStampFill === 'index';
  const statesByStop = plan.route.stops.map((stop) => stopStates(stop, input.writing, input.towns, fromIndex));
  const measured = cardFacts(plan);
  const states: string[] = [];
  for (const list of statesByStop) for (const st of list) if (!states.includes(st.code)) states.push(st.code);
  const facts = { ...measured, states: states.length ? states : measured.states };
  const keys = plan.route.stops.flatMap((s) => s.pictures.map((p) => p.key));
  // On a slide of its own the card's Photo ground is the slide's own picture.
  const groundPicture = keys.length && !input.below ? keys[keys.length - 1] : null;
  // A photo ground with no picture on the road is the look's own solid.
  const ground: CardGround = o.cardGround === 'photo' && !groundPicture && !input.below ? 'solid' : o.cardGround;
  const n = plan.route.stops.length;
  const dateOfDay = (day: number) => calendar.find((d) => d.dayNumber === day)?.date ?? '';
  const first = plan.clock && n ? dateOfDay(Math.floor(plan.clock.arrive[0])) : (calendar[0]?.date ?? '');
  const last = plan.clock && n ? dateOfDay(Math.max(1, Math.ceil(plan.clock.leave[n - 1]) - 1)) : (calendar[calendar.length - 1]?.date ?? '');
  return {
    face: o.cardFace,
    card: { ...o, cardGround: ground },
    theme,
    ink: cardInk(ground, theme, o),
    plan,
    unit,
    facts,
    cells: cardCells(facts, o.cardFacts, input.words, unit),
    labels: cardLabels(plan, o, input.towns),
    days: cardDays(calendar, plan),
    title: o.cardTitle.trim() || (input.tripName ?? '').trim(),
    subtitle: o.cardSubtitle.trim() || DEFAULT_SUBTITLE,
    from: writtenDate(first),
    to: writtenDate(last),
    tripDays: calendar.length,
    vehicle: input.vehicle,
    groundPicture,
    sheet: keys.slice(0, SHEET_PICTURES),
    below: !!input.below,
    stamps: passportStamps(plan.route.stops, o, (stop) => statesByStop[plan.route.stops.indexOf(stop)] ?? []),
  };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** «1 MAR 2025» for `2025-03-01`; empty for anything else. */
export function writtenDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
