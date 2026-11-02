/**
 * A post of the series, as the composer draws it: an opening, the post's own
 * blocks with their captions, and an ending. It is ASSEMBLED, not stored:
 * the public skeleton of a post (`story-script.ts`, `PostSkeleton` — which
 * blocks, how long, when each caption speaks) meets the author's private
 * script (the words, numbers and places) in `assemble`.
 */
import { OV, type Cap } from './charte';
import type { Hook } from './hook';
import type { Lang } from './locale';
import type { WallGrid, WallGroup } from './wall-grid';
import type { Charte, StyleBook } from './objects';
import type { MapGround } from './map-ground';
import type { StoryCamera } from './story-camera';
import type { RoutePace } from './route-pace';
import type { HookBadge } from './hook-badge';

/** The series' look, one for every post: the wall's grid and the texture's grain and vignette, each over its default. */
export interface StoryLook {
  wall?: Partial<WallGrid>;
  /** The vignette's darkness at the corners, 0 to 0.8 (the charte's 0.25 when absent). */
  vignette?: number;
  /** The moving grain's strength, 0 to 0.2 (the charte's 0.055 when absent). */
  grain?: number;
  /** The palette, the font roles and the weights every post is drawn in (`objects.ts`). */
  charte?: Charte;
  /** The series' settings for its objects, by key (`objects.ts`). */
  objects?: StyleBook;
  /** What the maps are drawn over: the outline, nothing, or OpenStreetMap's tiles (`map-ground.ts`). */
  map?: MapGround;
  /** How the map's camera follows the route: as before, or Trips' camera and its presets (`story-camera.ts`). */
  camera?: StoryCamera;
  /** How the route is drawn over its scene: by distance or by days, pauses at the stops, a head (`route-pace.ts`). */
  pace?: RoutePace;
  /** How the hook is drawn: Trips' badge in a title style and a composition, or the typed lines of before (`hook-badge.ts`). */
  hook?: HookBadge;
}

export interface BlockSpec {
  block: string;
  /** Seconds the block lasts, its overlap with the next included. */
  len: number;
  params?: Record<string, unknown>;
  cap?: Cap;
}

export interface Episode {
  /** The post's id in the registry, e.g. `ep04`. */
  id: string;
  /** HUD label, e.g. `EP.04`. */
  number: string;
  title: string;
  season: number;
  /** The post after this one, or null for the season's closing card. */
  next: { number: string; title: string; thumb?: CanvasImageSource | null } | null;
  /** What the closing card names when there is no next post. */
  closing: { series: string; handle: string; ask: string };
  blocks: BlockSpec[];
  cover?: { line: string };
  /** The first seconds' words, over the first block, in place of the title opening (`hook.ts`). */
  hook?: Hook | null;
  /** The trip's first counted day (ISO), when a counting knows it — what the hook's « why now » reads. */
  since?: string;
  /** The language it is told in (`locale.ts`); absent = French. */
  lang?: Lang;
  /** The series' look: the wall's grid, the grain and the vignette (`story-script.ts`, `StoryLook`). */
  look?: StoryLook;
  /** This post's own settings for its objects, over the series' `look.objects` (`objects.ts`). */
  objects?: StyleBook;
  /** The wall's groups, when the look groups it by stage or month and the counting gave each picture its day (`wall-grid.ts`). */
  wallGroups?: WallGroup[] | null;
}

export type Slot = BlockSpec & { a: number; b: number; start: number; key: string };

export const INTRO_LEN = 3.6;
export const OUTRO_LEN = 4.4;

/** Opening + blocks + ending, each with its `[a, b)` slot and its overlapped start. (pure) */
export function slotsOf(ep: Episode): Slot[] {
  const all: BlockSpec[] = [
    // A post with a hook opens on its first block, the hook over it: the title would cost the first seconds.
    ...(ep.hook ? [] : [{ block: 'intro', len: INTRO_LEN, params: { title: ep.title, number: ep.number, season: ep.season } }]),
    ...ep.blocks,
    ep.next
      ? { block: 'recap', len: OUTRO_LEN, params: { next: ep.next } }
      : { block: 'recap-carte', len: OUTRO_LEN, params: { ...ep.closing } },
  ];
  let acc = 0;
  return all.map((s, i) => {
    const a = acc;
    acc += s.len;
    return { ...s, a, b: acc, start: i === 0 ? 0 : a - OV, key: `${i}-${s.block}` };
  });
}

export const totalSeconds = (ep: Episode): number => {
  const s = slotsOf(ep);
  return s[s.length - 1].b;
};

/**
 * How visible a slot is at `t` — the « noir » transition: a slot fades in over
 * the second half of its overlap and out over the first half of the next one's.
 * Zero outside the slot. (pure)
 */
export function slotAlpha(slots: readonly Slot[], i: number, t: number): number {
  const s = slots[i];
  const last = i === slots.length - 1;
  const end = last ? s.b : slots[i + 1].start + OV;
  if (t < s.start || t >= end) return 0;
  const lt = t - s.start;
  const len = end - s.start;
  const fadeIn = i === 0 ? 1 : clamp01((lt - OV / 2) / (OV / 2));
  const fadeOut = last ? 1 : clamp01((len - OV / 2 - lt) / (OV / 2));
  return Math.min(fadeIn, fadeOut);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
