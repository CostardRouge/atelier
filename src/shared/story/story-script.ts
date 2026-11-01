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
import type { Stop } from './geo';
import type { Episode, StoryLook } from './episode';
import { fillParams, fillText } from './story-facts';
import type { Hook } from './hook';
import type { Lang } from './locale';
import { readWallGrid, wallGroups, type WallStage } from './wall-grid';
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
}

export interface ScriptPost {
  title?: string;
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
  map?: { points?: 'ends' | 'starts' | 'places'; label?: 'place' | 'stage' | 'place-date' | 'none' };
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
  wall?: { skip?: number[]; pick?: Record<string, number>; chosen?: [number, string][] };
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
}

export const SCRIPT_KIND = 'atelier.story-script';

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
    v.length === 4 &&
    typeof v[0] === 'string' &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2]) &&
    typeof v[3] === 'string'
  );
}

/** Read a script file's JSON, keeping what is well formed and saying why when nothing is. */
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
          return {
            params: isObject(block.params) ? block.params : undefined,
            caption: typeof block.caption === 'string' ? block.caption : undefined,
          };
        })
      : undefined;
    posts[id] = {
      title: typeof value.title === 'string' ? value.title : undefined,
      cover: typeof value.cover === 'string' ? value.cover : undefined,
      blocks,
      sources: readSources(value.sources),
      facts: readFacts(value.facts),
      ...readHooks(value),
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

const HOOK_ENTRIES = ['type', 'rise', 'word', 'fade'];
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
    if (points || label) out.map = { ...(points ? { points } : {}), ...(label ? { label } : {}) };
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
    if (skip.length || Object.keys(pick).length || chosen.length)
      out.wall = { ...(skip.length ? { skip } : {}), ...(Object.keys(pick).length ? { pick } : {}), ...(chosen.length ? { chosen } : {}) };
  }
  return out.trip || out.winnow || out.map || out.days || out.wall ? out : undefined;
}

/** The series' look, kept field by field when well formed. */
function readLook(raw: unknown): StoryLook | undefined {
  if (!isObject(raw)) return undefined;
  const level = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : undefined);
  const wall = readWallGrid(raw.wall);
  const vignette = level(raw.vignette, 0.8);
  const grain = level(raw.grain, 0.2);
  const look: StoryLook = {
    ...(wall ? { wall } : {}),
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
  };
}

/** The pictures ticked in the picker a script keeps at most; more are thinned evenly over their days (`withChosenWall`). */
export const MAX_CHOSEN = 2000;

/** No wall shows more pictures than this; a script asking for more is cut. */
export const MAX_TILES = 400;

/** What a caption reads when no script is loaded. */
export const placeholderCaption = (i: number): string => `⟨ caption ${i + 1} ⟩`;

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
  return {
    id: skeleton.id,
    number: skeleton.number,
    title: title(skeleton),
    season: skeleton.season,
    next: next ? { number: next.number, title: title(next) } : null,
    closing: { series: script?.series ?? '', handle: script?.handle ?? '', ask: script?.ask ?? '' },
    cover: { line: fillText(mine?.cover ?? '', values, lang) },
    lang,
    ...(script?.look ? { look: script.look } : {}),
    wallGroups: wallGroups(
      (mine?.facts ?? script?.facts)?.tileDays,
      script?.look?.wall?.group ?? 'none',
      (mine?.facts ?? script?.facts)?.stages,
      (iso) => monthText(iso, lang),
    ),
    hook: hook ? { ...hook, lines: hook.lines.map((l) => fillText(l, values, lang)) } : null,
    blocks: skeleton.blocks.map((b, i) => {
      const words = mine?.blocks?.[i];
      const given = { ...(b.params ?? {}), ...(words?.params ?? {}) };
      // Under a hook the first block is its picture: a wall says nothing of its own there.
      if (hook && i === 0 && b.block === 'wall') given.quiet = true;
      // A season's recap the script does not spell out lists the season's own posts, from the series.
      if (b.block === 'season-recap' && !Array.isArray(given.episodes)) {
        given.episodes = registry
          .filter((p) => p.season === skeleton.season)
          .map((p) => ({ number: p.number, title: title(p), line: fillText(script?.posts[p.id]?.cover ?? '', values, lang) }));
      }
      return {
        block: b.block,
        len: b.len,
        params: fillParams(given, values, lang) as Record<string, unknown>,
        cap: b.cap ? { a: b.cap.a, b: b.cap.b, text: fillText(words?.caption ?? placeholderCaption(i), values, lang) } : null,
      };
    }),
  };
}
