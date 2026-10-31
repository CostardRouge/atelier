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
import type { Episode } from './episode';
import { fillParams, fillText } from './story-facts';

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
}

/**
 * Where an episode's data comes from, the way Flight Atlas takes its flights:
 * a trip of Trips on this device (its road and places draw the map) and a
 * connected Winnow (counted over the trip's days). Names only — the trip
 * stays in this browser, the Winnow behind its connection.
 */
export interface ScriptSources {
  /** The trip's id, and the name it had, so a trip gone from this device is still named. */
  trip?: { id: string; name: string };
  /** A connected Winnow, by its source id (its host). */
  winnow?: { source: string };
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
      series: text(raw.series),
      handle: text(raw.handle),
      ask: text(raw.ask),
      stops: Array.isArray(raw.stops) ? raw.stops.filter(isStop) : undefined,
      posts,
      sources: readSources(raw.sources),
      facts: readFacts(raw.facts),
      channels,
      topics,
    },
  };
}

/** A fact's name: dotted lowercase words, the way a caption cites it. */
const FACT_KEY = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;

function readSources(raw: unknown): ScriptSources | undefined {
  if (!isObject(raw)) return undefined;
  const out: ScriptSources = {};
  const trip = raw.trip;
  if (isObject(trip) && typeof trip.id === 'string' && trip.id) {
    out.trip = { id: trip.id, name: typeof trip.name === 'string' ? trip.name : '' };
  }
  const winnow = raw.winnow;
  if (isObject(winnow) && typeof winnow.source === 'string' && winnow.source) out.winnow = { source: winnow.source };
  return out.trip || out.winnow ? out : undefined;
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
  return {
    at: raw.at,
    from: typeof raw.from === 'string' ? raw.from : undefined,
    values,
    ...(tiles?.length ? { tiles } : {}),
    ...(holes?.length ? { holes: holes.map((h): [string, string] => [h[0], h[1]]) } : {}),
  };
}

/** No wall shows more pictures than this; a script asking for more is cut. */
const MAX_TILES = 400;

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
  const title = (id: PostSkeleton) => fillText(script?.posts[id.id]?.title ?? id.number, values);
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
    cover: { line: fillText(mine?.cover ?? '', values) },
    blocks: skeleton.blocks.map((b, i) => {
      const words = mine?.blocks?.[i];
      const given = { ...(b.params ?? {}), ...(words?.params ?? {}) };
      // A season's recap the script does not spell out lists the season's own posts, from the series.
      if (b.block === 'season-recap' && !Array.isArray(given.episodes)) {
        given.episodes = registry
          .filter((p) => p.season === skeleton.season)
          .map((p) => ({ number: p.number, title: title(p), line: fillText(script?.posts[p.id]?.cover ?? '', values) }));
      }
      return {
        block: b.block,
        len: b.len,
        params: fillParams(given, values) as Record<string, unknown>,
        cap: b.cap ? { a: b.cap.a, b: b.cap.b, text: fillText(words?.caption ?? placeholderCaption(i), values) } : null,
      };
    }),
  };
}
