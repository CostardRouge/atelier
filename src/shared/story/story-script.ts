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
}

export const SCRIPT_KIND = 'atelier.story-script';

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
    };
  }
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
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
    },
  };
}

/** What a caption reads when no script is loaded. */
export const placeholderCaption = (i: number): string => `⟨ caption ${i + 1} ⟩`;

/**
 * Join a post's skeleton and the script into the episode the composer draws.
 * `registry` is the whole series in order: it gives the next post, which the
 * ending names. (pure)
 */
export function assemble(skeleton: PostSkeleton, script: StoryScript | null, registry: readonly PostSkeleton[]): Episode {
  const mine = script?.posts[skeleton.id];
  const title = (id: PostSkeleton) => script?.posts[id.id]?.title ?? id.number;
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
    cover: { line: mine?.cover ?? '' },
    blocks: skeleton.blocks.map((b, i) => {
      const words = mine?.blocks?.[i];
      return {
        block: b.block,
        len: b.len,
        params: { ...(b.params ?? {}), ...(words?.params ?? {}) },
        cap: b.cap ? { a: b.cap.a, b: b.cap.b, text: words?.caption ?? placeholderCaption(i) } : null,
      };
    }),
  };
}
