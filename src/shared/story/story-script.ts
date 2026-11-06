/**
 * A post is two halves that meet only on the author's machine.
 *
 * The SKELETON is public, in this repository: which blocks a post plays, how
 * long each lasts, when each caption speaks. The SCRIPT is private — the
 * words said, the numbers, the places, the devices — kept by the author
 * outside Atelier (a `.story.json` file in his own notes) and loaded into the
 * tool. `assemble` joins them into the `Episode` the composer draws; without
 * a script a post still plays, every caption a placeholder, so the shape can
 * be judged and nothing personal ships with the code. (pure)
 */
import { readMapGround } from './map-ground';
import { readStoryCamera } from './story-camera';
import { readRoutePace } from './route-pace';
import { readHookBadge, readPostBadge } from './hook-badge';
import { readMapNames, type MapNames } from './map-names';
import { readWallRules, type WallRules } from './wall-pick';
import { readWallOrder } from './wall-correct';
import type { Stop } from './geo';
import type { Episode, StoryLook } from './episode';
import { fillParams, fillText } from './story-facts';
import type { Hook } from './hook';
import type { Lang } from './locale';
import { readWallMotion, type WallMotion } from './wall-motion';
import { readCaptionLook } from './caption-layout';
import { readWallGrid, wallGroups, type WallStage } from './wall-grid';
import { readCharte, readStyleBook, type StyleBook } from './objects';
import { monthText } from './locale';

export interface SkeletonBlock {
  block: string;
  len: number;
  /** When the caption speaks, in the block's own seconds; its words are the script's. */
  cap?: { a: number; b: number } | null;
  /** Visual settings only — never content. */
  params?: Record<string, unknown>;
}

export interface PostSkeleton {
  id: string;
  /** HUD label, e.g. `EP.04`. */
  number: string;
  season: number;
  blocks: SkeletonBlock[];
}

export interface ScriptBlock {
  params?: Record<string, unknown>;
  caption?: string;
  /** The scene's length in this post, seconds, over the skeleton's (the Studio's timeline). */
  len?: number;
  /** When its caption speaks, seconds into the scene, over the skeleton's. */
  cap?: { a: number; b: number };
}

export interface ScriptPost {
  title?: string;
  /** This post's own number (the HUD's, the badge's header, the next post's card), over the skeleton's `EP.04`. */
  number?: string;
  cover?: string;
  blocks?: ScriptBlock[];
  /** This post's own sources, over the series' (`sources.ts`). */
  sources?: ScriptSources;
  /** Numbers counted for this post alone, over the series'. */
  facts?: ScriptFacts;
  /**
   * The post's hook and its variants (`hook.ts`), in place of the title
   * opening; `hookActive` says which one plays and exports. Its words are
   * private, like the captions.
   */
  hooks?: Hook[];
  hookActive?: number;
  /** What the post pays off — kept beside the hook so it never promises more. */
  promise?: string;
  /** This post's own settings for its objects, over the series' (`objects.ts`). */
  objects?: StyleBook;
  /** This post's own wall motion, over the series' (`wall-motion.ts`). */
  wallMotion?: Partial<WallMotion>;
}

/**
 * Where an episode's data comes from, the way Flight Atlas takes its flights:
 * a trip of Trips on this device (its road and places draw the map) and a
 * connected Winnow (counted over the trip's days). Names only — the trip
 * stays in this browser, the Winnow behind its connection.
 */
export interface ScriptSources {
  /**
   * The trip's id, and the name it had, so a trip gone from this device is
   * still named; `stages` keeps only those stages (by id) for the route, the
   * towns and the counted days — a trip that begins in Bali told from
   * Australia. Absent = every stage.
   */
  trip?: { id: string; name: string; stages?: string[] };
  /** A connected Winnow, by its source id (its host). */
  winnow?: { source: string };
  /**
   * What the map names (`trip-map.ts`): which points — where each stage
   * starts and ends (`ends`, the default), starts only, or every place — and
   * what each says: the place, the stage, the place and its day, or nothing.
   */
  map?: {
    points?: 'ends' | 'starts' | 'places';
    /** What each point said before the two lines (`names`): read as the matching preset when `names` is absent. */
    label?: 'place' | 'stage' | 'place-date' | 'none';
    /** What each point says: two lines of fields, a place's writing, which points (`map-names.ts`). */
    names?: MapNames;
    /**
     * The author's own stops, in the order the map visits them — present, they
     * ARE the map's points (`points` then only says what they were taken from,
     * `took`). Each keeps its name, position and day, nothing of the trip's ids:
     * the map stays as made when the trip changes.
     */
    stops?: MapStopRef[];
    took?: 'ends' | 'starts' | 'places';
    /** Nearby stops drawn as one halt (Trips' `stop-clusters.ts`), never edited out of the list. */
    group?: { km: number; visits?: 'consecutive' | 'all'; name?: 'town' | 'first' | 'central' };
    /** Which recorded road is drawn: between the first and last stop, or the whole trip. */
    route?: 'stops' | 'all';
  };
  /**
   * The days counted, when the series says so rather than its kept stages:
   * a first and last day, and days left out (`skip`, ISO dates).
   */
  days?: { from?: string; to?: string; skip?: string[] };
  /**
   * The wall's pictures as the author chose them: Winnow asset ids never to
   * show (`skip`), and a picture of his own choosing for a day (`pick`,
   * ISO day → asset id) in place of that day's cover. `chosen`: the pictures
   * ticked in the Winnow picker, `[asset id, ISO day]` in day order — the
   * wall then draws from them rather than one cover a day (`chosenPicks`).
   */
  wall?: {
    skip?: number[];
    pick?: Record<string, number>;
    chosen?: [number, string][];
    /** The wall chosen by rules (`wall-pick.ts`) instead of one a day; `skip` is then what he removed. */
    rules?: WallRules;
    /** Pictures he pinned on the wall, whatever the rules say. */
    pin?: number[];
    /**
     * The wall FROZEN by his corrections (`wall-correct.ts`): its pictures in
     * his order, `[asset id, ISO day]` — what ✕, ⇄ or a drag left. Counting
     * lays exactly these; absent = the rules choose.
     */
    order?: [number, string][];
  };
}

/**
 * Numbers FROZEN from the sources at a moment, so a post exports the same
 * tomorrow; counting again replaces them. Keys are dotted names a caption can
 * cite (`media.total`).
 */
export interface ScriptFacts {
  /** When they were counted, an ISO date-time. */
  at: string;
  /** What they were counted from, as said (« Australie · winnow.example »). */
  from?: string;
  values: Record<string, number>;
  /**
   * The pictures the wall shows, Winnow asset ids in day order — one per day
   * of the trip, chosen when it was counted (`story-facts.ts`, `wallPicks`).
   * Ids only: the thumbnails are kept on this device (`wall-cache.ts`).
   */
  tiles?: number[];
  /** Each tile's day, ISO, aligned with `tiles` — what groups the wall by stage or month. */
  tileDays?: string[];
  /** The stages counted, their names and days, in date order — what a wall grouped by stage reads. */
  stages?: WallStage[];
  /** Runs of days with media but no position, `[first, last]` ISO dates — the map's holes (`geoFacts`). */
  holes?: [string, string][];
  /**
   * A picture each camera took over the counted days, a Winnow asset id by
   * `deviceKey` — the cover of its busiest day, chosen when counted — what
   * the gear block shows beside its name (`story-pictures.ts`).
   */
  devicePics?: Record<string, number>;
  /**
   * Pictures he DEVELOPED over the counted days, as `[original, final]`
   * Winnow asset ids — a Gallery final and the original it was edited from
   * (Winnow's lineage, `original_asset_id`) — what the before/after block
   * shows (`story-pictures.ts`). At most `MAX_EDITS`, spread over the trip.
   */
  edits?: [number, number][];
}

export const SCRIPT_KIND = 'atelier.story-script';

/**
 * A series started here, with no file (his « commencer dès le départ »,
 * 2026-11-02): its name and language, every post a skeleton's placeholder
 * until written. What a loaded script holds — sources, look, words — is
 * added from the editor. (pure)
 */
export function newScript(series: string, lang: 'fr' | 'en' = 'fr'): StoryScript {
  return { kind: SCRIPT_KIND, version: 1, series: series.trim() || 'My series', lang, posts: {} } as StoryScript;
}

/** Where a subject stands on one channel. */
export type CellState = 'idee' | 'encours' | 'pret' | 'publie' | 'non';
export const CELL_STATES: readonly CellState[] = ['idee', 'encours', 'pret', 'publie', 'non'];

export interface Cell {
  s: CellState;
  /** The day it went out, `YYYY-MM-DD`. */
  date?: string;
  /** The published post, or a draft. */
  url?: string;
}

/** One stop of a series' own map. */
export interface MapStopRef {
  name: string;
  lat: number;
  lon: number;
  /** Its day (ISO), when it came from the trip — said by the day and date fields. */
  day?: string;
  /** A name typed by hand for it: the map says this, whatever the fields (`map-names.ts`). */
  own?: string;
}

/** The most stops a series keeps on its map. */
export const MAX_MAP_STOPS = 200;

/** A column of the map: where a subject can be told. */
export interface ScriptChannel {
  id: string;
  name: string;
  /** What goes there (« Reels, carrousels »). */
  format?: string;
  /** For whom, in what tone. */
  voice?: string;
}

/**
 * A line of the map of subjects — a pillar (no parent), a subject, or a
 * version of one. A line that names a `post` IS that post of the series; the
 * others are subjects not made yet.
 */
export interface ScriptTopic {
  id: string;
  title: string;
  parent?: string;
  order?: number;
  hook?: string;
  arc?: string;
  notes?: string;
  /** Proposed by Claude, not yet kept by the author. */
  proposed?: boolean;
  /** The id of the post in the series this line is. */
  post?: string;
  cells?: Record<string, Cell>;
}

export interface StoryScript {
  kind: typeof SCRIPT_KIND;
  version: 1;
  /**
   * The series' identity where it is kept on a Winnow (`script-remote.ts`):
   * minted the first time it is kept there, so the same series opened on the
   * Mac and the phone is ONE document. Absent on a script never kept.
   */
  id?: string;
  /** The language the series is told in (`locale.ts`): its numbers, its days, the blocks' own words. Absent = French. */
  lang?: Lang;
  /** The series' name, on the season's closing card. */
  series?: string;
  /** The account, on the closing card. */
  handle?: string;
  /** The closing card's request (« Enregistre pour la suite »). */
  ask?: string;
  /** The trip the maps draw. */
  stops?: Stop[];
  posts: Record<string, ScriptPost>;
  /** The series' sources and the numbers counted from them; a post may override both. */
  sources?: ScriptSources;
  facts?: ScriptFacts;
  /** The series' look: the wall's grid, the grain, the vignette (`episode.ts`, `StoryLook`). */
  look?: StoryLook;
  /** The map of subjects: its channels and its lines (`story-map.ts`). */
  channels?: ScriptChannel[];
  topics?: ScriptTopic[];
}

export type ScriptParse = { ok: true; script: StoryScript } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isStop(v: unknown): v is Stop {
  return (
    Array.isArray(v) &&
    v.length >= 4 &&
    v.length <= 6 &&
    typeof v[0] === 'string' &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2]) &&
    typeof v[3] === 'string' &&
    v.slice(4).every((x) => typeof x === 'string')
  );
}

/** Read a script file's JSON, keeping what is well formed and saying why when nothing is. */
/** What a script's id may be: a URL segment a Winnow's document bucket takes. */
export const SCRIPT_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function parseScript(raw: unknown): ScriptParse {
  if (!isObject(raw)) return { ok: false, reason: 'This file is not a story script: it holds no object.' };
  if (raw.kind !== SCRIPT_KIND) return { ok: false, reason: `This file is not a story script (its kind is not “${SCRIPT_KIND}”).` };
  if (raw.version !== 1) return { ok: false, reason: `This story script is version ${String(raw.version)}; this Atelier reads version 1.` };
  if (!isObject(raw.posts)) return { ok: false, reason: 'This story script has no posts.' };
  const posts: Record<string, ScriptPost> = {};
  for (const [id, value] of Object.entries(raw.posts)) {
    if (!isObject(value)) continue;
    const blocks = Array.isArray(value.blocks)
      ? value.blocks.map((b): ScriptBlock => {
          const block = isObject(b) ? b : {};
          const len = typeof block.len === 'number' && Number.isFinite(block.len) ? Math.min(60, Math.max(0.5, block.len)) : undefined;
          const cap =
            isObject(block.cap) && typeof block.cap.a === 'number' && typeof block.cap.b === 'number' && block.cap.a >= 0 && block.cap.b > block.cap.a
              ? { a: block.cap.a, b: block.cap.b }
              : undefined;
          return {
            params: isObject(block.params) ? block.params : undefined,
            caption: typeof block.caption === 'string' ? block.caption : undefined,
            ...(len !== undefined ? { len } : {}),
            ...(cap ? { cap } : {}),
          };
        })
      : undefined;
    posts[id] = {
      title: typeof value.title === 'string' ? value.title : undefined,
      ...(typeof value.number === 'string' && value.number.trim() ? { number: value.number.trim().slice(0, 24) } : {}),
      cover: typeof value.cover === 'string' ? value.cover : undefined,
      blocks,
      sources: readSources(value.sources),
      facts: readFacts(value.facts),
      ...readHooks(value),
      ...(readStyleBook(value.objects) ? { objects: readStyleBook(value.objects) } : {}),
      ...(readWallMotion(value.wallMotion) ? { wallMotion: readWallMotion(value.wallMotion) } : {}),
    };
  }
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const channels = Array.isArray(raw.channels)
    ? raw.channels.flatMap((c): ScriptChannel[] =>
        isObject(c) && typeof c.id === 'string' && typeof c.name === 'string'
          ? [{ id: c.id, name: c.name, format: text(c.format), voice: text(c.voice) }]
          : [],
      )
    : undefined;
  const topics = Array.isArray(raw.topics)
    ? raw.topics.flatMap((t): ScriptTopic[] => {
        if (!isObject(t) || typeof t.id !== 'string' || typeof t.title !== 'string') return [];
        const cells: Record<string, Cell> = {};
        if (isObject(t.cells)) {
          for (const [ch, c] of Object.entries(t.cells)) {
            if (isObject(c) && CELL_STATES.includes(c.s as CellState)) {
              cells[ch] = { s: c.s as CellState, date: text(c.date), url: text(c.url) };
            }
          }
        }
        return [
          {
            id: t.id,
            title: t.title,
            parent: text(t.parent) || undefined,
            order: Number.isFinite(t.order) ? (t.order as number) : undefined,
            hook: text(t.hook),
            arc: text(t.arc),
            notes: text(t.notes),
            proposed: t.proposed === true ? true : undefined,
            post: text(t.post),
            cells,
          },
        ];
      })
    : undefined;
  return {
    ok: true,
    script: {
      kind: SCRIPT_KIND,
      version: 1,
      ...(typeof raw.id === 'string' && SCRIPT_ID.test(raw.id) ? { id: raw.id } : {}),
      ...(raw.lang === 'en' || raw.lang === 'fr' ? { lang: raw.lang } : {}),
      series: text(raw.series),
      handle: text(raw.handle),
      ask: text(raw.ask),
      stops: Array.isArray(raw.stops) ? raw.stops.filter(isStop) : undefined,
      posts,
      sources: readSources(raw.sources),
      facts: readFacts(raw.facts),
      look: readLook(raw.look),
      channels,
      topics,
    },
  };
}

const HOOK_ENTRIES = ['type', 'rise', 'word', 'fade', 'wipe', 'slam'];
const HOOK_EXITS = ['fade', 'erase', 'fly', 'cut'];
const HOOK_PLACES = ['top', 'center', 'bottom'];
const HOOK_INKS = ['paper', 'ink', 'accent'];

/** A post's hooks, kept field by field when well formed (`hook.ts`). */
function readHooks(raw: Record<string, unknown>): Pick<ScriptPost, 'hooks' | 'hookActive' | 'promise'> {
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  const oneOf = <T extends string>(v: unknown, list: string[]) => (typeof v === 'string' && list.includes(v) ? (v as T) : undefined);
  const hooks = Array.isArray(raw.hooks)
    ? raw.hooks.flatMap((h): Hook[] => {
        if (!isObject(h) || !Array.isArray(h.lines)) return [];
        const lines = h.lines.filter((l): l is string => typeof l === 'string').slice(0, 3);
        if (!lines.length) return [];
        const sounds = isObject(h.sounds) ? h.sounds : {};
        const sound = (v: unknown) => (typeof v === 'string' && v.length < 40 ? v : undefined);
        const hook: Hook = {
          lines,
          sticker: h.sticker === null ? null : num(h.sticker, 0, lines.length - 1),
          spoken: typeof h.spoken === 'string' ? h.spoken : undefined,
          entry: oneOf(h.entry, HOOK_ENTRIES),
          exit: oneOf(h.exit, HOOK_EXITS),
          at: num(h.at, 0, 10),
          cps: num(h.cps, 2, 60),
          gap: num(h.gap, 0, 10),
          hold: num(h.hold, 0, 10),
          place: oneOf(h.place, HOOK_PLACES),
          ink: oneOf(h.ink, HOOK_INKS),
          scrim: num(h.scrim, 0, 1),
          sounds: { keys: sound(sounds.keys), impact: sound(sounds.impact), whoosh: sound(sounds.whoosh) },
          pieces: readHookPieces(h.pieces),
          badge: readPostBadge(h.badge),
        };
        // Absent fields stay absent: the defaults live in one place (`HOOK_DEFAULTS`).
        for (const k of Object.keys(hook) as (keyof Hook)[]) if (hook[k] === undefined) delete hook[k];
        return [hook];
      })
    : [];
  const active = num(raw.hookActive, 0, Math.max(0, hooks.length - 1));
  return {
    ...(hooks.length ? { hooks } : {}),
    ...(hooks.length && active !== undefined ? { hookActive: Math.round(active) } : {}),
    ...(typeof raw.promise === 'string' && raw.promise ? { promise: raw.promise } : {}),
  };
}

/** A hook's own piece texts, each a short line. */
function readHookPieces(raw: unknown): Hook['pieces'] {
  if (!isObject(raw)) return undefined;
  const out: NonNullable<Hook['pieces']> = {};
  for (const k of ['header', 'place', 'camera', 'why'] as const) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 120);
  }
  return Object.keys(out).length ? out : undefined;
}

/** The hook a post plays: its active variant, else its first; null without one. */
export function activeHook(post: ScriptPost | undefined): Hook | null {
  if (!post?.hooks?.length) return null;
  return post.hooks[Math.min(post.hooks.length - 1, Math.max(0, post.hookActive ?? 0))] ?? null;
}

/** A fact's name: dotted lowercase words, the way a caption cites it. */
const FACT_KEY = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;

function readSources(raw: unknown): ScriptSources | undefined {
  if (!isObject(raw)) return undefined;
  const out: ScriptSources = {};
  const trip = raw.trip;
  if (isObject(trip) && typeof trip.id === 'string' && trip.id) {
    const stages = Array.isArray(trip.stages) ? trip.stages.filter((s): s is string => typeof s === 'string' && s.length > 0) : null;
    out.trip = { id: trip.id, name: typeof trip.name === 'string' ? trip.name : '', ...(stages ? { stages } : {}) };
  }
  const winnow = raw.winnow;
  if (isObject(winnow) && typeof winnow.source === 'string' && winnow.source) out.winnow = { source: winnow.source };
  const map = raw.map;
  if (isObject(map)) {
    const points = ['ends', 'starts', 'places'].includes(map.points as string) ? (map.points as 'ends' | 'starts' | 'places') : undefined;
    const label = ['place', 'stage', 'place-date', 'none'].includes(map.label as string)
      ? (map.label as 'place' | 'stage' | 'place-date' | 'none')
      : undefined;
    const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
    const stops = Array.isArray(map.stops)
      ? map.stops
          .filter((s): s is Record<string, unknown> => isObject(s) && typeof s.name === 'string' && num(s.lat, -90, 90) && num(s.lon, -180, 180))
          .slice(0, MAX_MAP_STOPS)
          .map((s): MapStopRef => ({
            name: s.name as string,
            lat: s.lat as number,
            lon: s.lon as number,
            ...(typeof s.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.day) ? { day: s.day } : {}),
            ...(typeof s.own === 'string' && s.own.trim() ? { own: s.own.trim().slice(0, 80) } : {}),
          }))
      : undefined;
    const took = ['ends', 'starts', 'places'].includes(map.took as string) ? (map.took as 'ends' | 'starts' | 'places') : undefined;
    const g = isObject(map.group) && num(map.group.km, 0.5, 80) ? map.group : null;
    const visits = g?.visits === 'all' || g?.visits === 'consecutive' ? (g.visits as 'all' | 'consecutive') : undefined;
    const naming = g?.name === 'town' || g?.name === 'first' || g?.name === 'central' ? (g.name as 'town' | 'first' | 'central') : undefined;
    const group = g ? { km: g.km as number, ...(visits ? { visits } : {}), ...(naming ? { name: naming } : {}) } : undefined;
    const route = map.route === 'stops' || map.route === 'all' ? map.route : undefined;
    const names = readMapNames(map.names);
    if (points || label || names || stops || group || route)
      out.map = {
        ...(points ? { points } : {}),
        ...(label ? { label } : {}),
        ...(names ? { names } : {}),
        ...(stops ? { stops } : {}),
        ...(stops && took ? { took } : {}),
        ...(group ? { group } : {}),
        ...(route ? { route } : {}),
      };
  }
  const days = raw.days;
  if (isObject(days)) {
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const from = day(days.from);
    const to = day(days.to);
    const skip = Array.isArray(days.skip) ? days.skip.map(day).filter((d): d is string => !!d) : [];
    if (from || to || skip.length) out.days = { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(skip.length ? { skip } : {}) };
  }
  const wall = raw.wall;
  if (isObject(wall)) {
    const id = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
    const skip = Array.isArray(wall.skip) ? wall.skip.filter(id) : [];
    const pick: Record<string, number> = {};
    if (isObject(wall.pick)) for (const [d, v] of Object.entries(wall.pick)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && id(v)) pick[d] = v;
    const chosen = Array.isArray(wall.chosen)
      ? wall.chosen
          .filter((c): c is [number, string] => Array.isArray(c) && c.length === 2 && id(c[0]) && typeof c[1] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c[1]))
          .slice(0, MAX_CHOSEN)
          .map((c): [number, string] => [c[0], c[1]])
      : [];
    const rules = readWallRules(wall.rules);
    const pin = Array.isArray(wall.pin) ? [...new Set(wall.pin.filter(id))].slice(0, 2000) : [];
    // A frozen order belongs to a wall chosen by rules.
    const order = rules ? readWallOrder(wall.order, MAX_TILES) : [];
    if (skip.length || Object.keys(pick).length || chosen.length || rules || pin.length)
      out.wall = {
        ...(skip.length ? { skip } : {}),
        ...(Object.keys(pick).length ? { pick } : {}),
        ...(chosen.length ? { chosen } : {}),
        ...(rules ? { rules } : {}),
        ...(pin.length ? { pin } : {}),
        ...(order.length ? { order } : {}),
      };
  }
  return out.trip || out.winnow || out.map || out.days || out.wall ? out : undefined;
}

/** The series' look, kept field by field when well formed. */
function readLook(raw: unknown): StoryLook | undefined {
  if (!isObject(raw)) return undefined;
  const level = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : undefined);
  const wall = readWallGrid(raw.wall);
  const charte = readCharte(raw.charte);
  const objects = readStyleBook(raw.objects);
  const vignette = level(raw.vignette, 0.8);
  const grain = level(raw.grain, 0.2);
  const map = readMapGround(raw.map);
  const camera = readStoryCamera(raw.camera);
  const pace = readRoutePace(raw.pace);
  const hook = readHookBadge(raw.hook);
  const wallMotion = readWallMotion(raw.wallMotion);
  const captions = readCaptionLook(raw.captions);
  const look: StoryLook = {
    ...(captions ? { captions } : {}),
    ...(wallMotion ? { wallMotion } : {}),
    ...(hook ? { hook } : {}),
    ...(pace ? { pace } : {}),
    ...(map ? { map } : {}),
    ...(camera ? { camera } : {}),
    ...(wall ? { wall } : {}),
    ...(charte ? { charte } : {}),
    ...(objects ? { objects } : {}),
    ...(vignette !== undefined ? { vignette } : {}),
    ...(grain !== undefined ? { grain } : {}),
  };
  return Object.keys(look).length ? look : undefined;
}

function readFacts(raw: unknown): ScriptFacts | undefined {
  if (!isObject(raw) || typeof raw.at !== 'string' || !isObject(raw.values)) return undefined;
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.values)) {
    if (FACT_KEY.test(k) && typeof v === 'number' && Number.isFinite(v)) values[k] = v;
  }
  const tiles = Array.isArray(raw.tiles)
    ? raw.tiles.filter((n): n is number => Number.isInteger(n) && (n as number) > 0).slice(0, MAX_TILES)
    : undefined;
  const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const holes = Array.isArray(raw.holes)
    ? raw.holes.filter((h): h is [string, string] => Array.isArray(h) && h.length === 2 && isDay(h[0]) && isDay(h[1]) && h[0] <= h[1])
    : undefined;
  // The tiles' days count only when there is one for each tile.
  const tileDays =
    tiles?.length && Array.isArray(raw.tileDays) && raw.tileDays.length === tiles.length && raw.tileDays.every(isDay)
      ? (raw.tileDays as string[])
      : undefined;
  const stages = Array.isArray(raw.stages)
    ? raw.stages.flatMap((s): WallStage[] =>
        isObject(s) && typeof s.label === 'string' && isDay(s.from) && isDay(s.to) && s.from <= s.to ? [{ label: s.label, from: s.from, to: s.to }] : [],
      )
    : undefined;
  return {
    at: raw.at,
    from: typeof raw.from === 'string' ? raw.from : undefined,
    values,
    ...(tiles?.length ? { tiles } : {}),
    ...(tileDays ? { tileDays } : {}),
    ...(stages?.length ? { stages } : {}),
    ...(holes?.length ? { holes: holes.map((h): [string, string] => [h[0], h[1]]) } : {}),
    ...(() => {
      if (!isObject(raw.devicePics)) return {};
      const pics: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw.devicePics)) if (/^gear\.[a-z0-9]+$/.test(k) && Number.isInteger(v) && (v as number) > 0) pics[k] = v as number;
      return Object.keys(pics).length ? { devicePics: pics } : {};
    })(),
    ...(() => {
      const edits = Array.isArray(raw.edits)
        ? raw.edits.filter((e): e is [number, number] => Array.isArray(e) && e.length === 2 && e.every((n) => Number.isInteger(n) && (n as number) > 0)).slice(0, MAX_EDITS)
        : [];
      return edits.length ? { edits: edits.map((e): [number, number] => [e[0], e[1]]) } : {};
    })(),
  };
}

/** The pictures ticked in the picker a script keeps at most; more are thinned evenly over their days (`withChosenWall`). */
export const MAX_CHOSEN = 2000;

/** The developed pictures counting keeps for the before/after block. */
export const MAX_EDITS = 6;

/** No wall shows more pictures than this; a script asking for more is cut. */
export const MAX_TILES = 400;

/** What a caption reads when no script is loaded. */
export const placeholderCaption = (i: number): string => `⟨ caption ${i + 1} ⟩`;
/** Whether a caption is still the placeholder — what the pre-export check refuses to let ship unsaid. */
export const isPlaceholderCaption = (text: string): boolean => /^⟨ caption \d+ ⟩$/.test(text.trim());

/**
 * Join a post's skeleton and the script into the episode the composer draws.
 * `registry` is the whole series in order: it gives the next post, which the
 * ending names. (pure)
 */
export function assemble(skeleton: PostSkeleton, script: StoryScript | null, registry: readonly PostSkeleton[]): Episode {
  const mine = script?.posts[skeleton.id];
  // The numbers this post cites (`story-facts.ts`): its own counting, else the series'.
  const values = (mine?.facts ?? script?.facts)?.values ?? null;
  const hook = activeHook(mine);
  const lang: Lang = script?.lang ?? 'fr';
  const title = (id: PostSkeleton) => fillText(script?.posts[id.id]?.title ?? id.number, values, lang);
  const at = registry.findIndex((p) => p.id === skeleton.id);
  const after = at >= 0 ? registry[at + 1] : undefined;
  const next = after && after.season === skeleton.season ? after : undefined;
  const numberOf = (id: PostSkeleton) => script?.posts[id.id]?.number ?? id.number;
  return {
    id: skeleton.id,
    number: numberOf(skeleton),
    title: title(skeleton),
    season: skeleton.season,
    next: next ? { number: numberOf(next), title: title(next) } : null,
    closing: { series: script?.series ?? '', handle: script?.handle ?? '', ask: script?.ask ?? '' },
    cover: { line: fillText(mine?.cover ?? '', values, lang) },
    lang,
    ...(script?.look ? { look: script.look } : {}),
    ...(mine?.objects ? { objects: mine.objects } : {}),
    ...(mine?.wallMotion ? { wallMotion: mine.wallMotion } : {}),
    ...((mine?.facts ?? script?.facts)?.devicePics ? { devicePics: (mine?.facts ?? script?.facts)!.devicePics } : {}),
    ...((mine?.facts ?? script?.facts)?.edits ? { edits: (mine?.facts ?? script?.facts)!.edits } : {}),
    wallGroups: wallGroups(
      (mine?.facts ?? script?.facts)?.tileDays,
      script?.look?.wall?.group ?? 'none',
      (mine?.facts ?? script?.facts)?.stages,
      (iso) => monthText(iso, lang),
    ),
    ...(script?.sources?.wall?.order?.length ? { wallFrozen: true } : {}),
    hook: hook ? { ...hook, lines: hook.lines.map((l) => fillText(l, values, lang)) } : null,
    ...(() => {
      const f = mine?.facts ?? script?.facts;
      const since = f?.stages?.[0]?.from ?? f?.tileDays?.[0];
      return since ? { since } : {};
    })(),
    blocks: skeleton.blocks.map((b, i) => {
      const words = mine?.blocks?.[i];
      const given = { ...(b.params ?? {}), ...(words?.params ?? {}) };
      // Under a hook the first block is its picture: a wall says nothing of its own there.
      if (hook && i === 0 && b.block === 'wall') given.quiet = true;
      // The wall's number says what was COUNTED when the script names none (measured on a new series: it drew the
      // block's neutral 100 000 over a trip of 60 media).
      if (b.block === 'wall' && given.count === undefined && values && typeof values['media.total'] === 'number') given.count = values['media.total'];
      // A season's recap the script does not spell out lists the season's own posts, from the series.
      if (b.block === 'season-recap' && !Array.isArray(given.episodes)) {
        given.episodes = registry
          .filter((p) => p.season === skeleton.season)
          .map((p) => ({ number: script?.posts[p.id]?.number ?? p.number, title: title(p), line: fillText(script?.posts[p.id]?.cover ?? '', values, lang) }));
      }
      // The Studio's timeline may set this post's scene length and caption window over the skeleton's.
      const len = words?.len ?? b.len;
      const at = words?.cap ?? b.cap;
      return {
        block: b.block,
        len,
        params: fillParams(given, values, lang) as Record<string, unknown>,
        cap: at ? { a: Math.min(at.a, len), b: Math.min(at.b, len), text: fillText(words?.caption ?? placeholderCaption(i), values, lang) } : null,
      };
    }),
  };
}
