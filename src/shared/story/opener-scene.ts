/**
 * Trips' OPENERS as Storytelling scenes (strategy G1, the O1 lab left open):
 * a map scene of a post may be drawn as the Itinerary or as Virée's 3D
 * drive instead of the series' map — the very engine Trips plays
 * (`roadtrip/hooks/`), prepared once on the series' TRIP (its legs, its
 * road, its vehicles, its look) and painted at the scene's clock. The scene
 * keeps its caption, its place in the post and its length; the opener plays
 * at its own pace and is sped up only to fit the scene. Without a trip on
 * this device the scene draws the series' map as before, so a post never
 * shows an empty frame.
 */
import { hookContextFor } from '../roadtrip/hooks/hook-context';
import type { HookOptions, HookRender } from '../roadtrip/hooks/hook-variant';
import { hookVariantById } from '../roadtrip/hooks/registry';
import type { TripDoc, TripPost } from '../roadtrip/trip-types';
import { PAL, type Ctx } from './motion';

export type StoryOpenerId = 'map' | 'drive';
export const STORY_OPENERS: readonly { id: 'story' | StoryOpenerId; label: string }[] = [
  { id: 'story', label: 'The series’ map' },
  { id: 'map', label: 'Trips’ Itinerary' },
  { id: 'drive', label: 'Trips’ Virée (3D drive)' },
];
export const isStoryOpener = (v: unknown): v is StoryOpenerId => v === 'map' || v === 'drive';

/**
 * What a story opener starts from: the trip's own places, whatever the
 * variant's stored default — and the Itinerary drawn in the charte's INK,
 * since Trips draws it in white over a photograph and a story map scene is
 * the series' paper (measured headless: white on linen read as nothing).
 */
const storyDefaults = (id: StoryOpenerId): HookOptions =>
  id === 'map' ? { stopsOn: 'places', size: 1, pathColor: PAL.ink, aheadColor: PAL.dim, labels: 'passed' } : { stopsOn: 'places' };

let TRIP: TripDoc | null = null;
let FIRST_DAY: string | null = null;
let SCENE_SECONDS = 5;
/** The series' trip on this device and its first counted day (`compose.ts`, per frame). */
export function setOpenerTrip(trip: TripDoc | null | undefined, firstDay?: string | null): void {
  TRIP = trip ?? null;
  FIRST_DAY = firstDay ?? null;
}
/** How long the scene being drawn lasts on its own clock (`compose.ts`, per slot). */
export function setOpenerScene(seconds: number): void {
  SCENE_SECONDS = Math.max(0.5, seconds);
}

const prepared = new Map<string, HookRender | null>();
/** The opener prepared on the trip for a scene of `seconds`, or null when it cannot run here. */
export function openerRender(id: StoryOpenerId, options: HookOptions | undefined, seconds: number, leg?: string | null): HookRender | null {
  const trip = TRIP;
  if (!trip) return null;
  // A Trips opener tells ONE leg — the one of its piece's day: the leg the scene names, else the series' first day's.
  const legDay = leg ? trip.stages?.find((st) => st.id === leg)?.startDate : undefined;
  const key = JSON.stringify([trip.id, trip.updatedAt ?? null, id, options ?? null, Math.round(seconds * 10), legDay ?? FIRST_DAY, PAL.ink, PAL.dim]);
  if (prepared.has(key)) return prepared.get(key)!;
  const variant = hookVariantById(id);
  let render: HookRender | null = null;
  if (variant) {
    const date = legDay ?? FIRST_DAY ?? trip.stages?.[0]?.startDate ?? trip.posts?.[0]?.date ?? '1970-01-01';
    // A piece of the trip that is no piece: the openers read its day and its id (never found among the trip's).
    const post = { id: '__storytelling', date } as unknown as TripPost;
    const ctx = hookContextFor(trip, post, 1080 / 1920, null, undefined, { durationSeconds: seconds, screenSeconds: seconds });
    if (!variant.unmet?.(ctx)) render = variant.prepare({ ...variant.defaults, ...storyDefaults(id), ...(options ?? {}) }, ctx);
  }
  if (prepared.size > 16) prepared.clear();
  prepared.set(key, render);
  return render;
}

/** The opener's clock at the scene's `lt`: its own pace, sped up only to end within the scene, then held. (pure) */
export function openerClock(lt: number, own: number, scene: number): number {
  if (!(own > 0)) return 0;
  const k = own > scene ? own / scene : 1;
  return Math.min(own - 1e-3, Math.max(0, lt * k));
}

/** Whether the opener can be drawn here for the scene being drawn (a trip on this device, an opener this build has). */
export const storyOpenerReady = (id: StoryOpenerId, options?: HookOptions, leg?: string | null): boolean => Boolean(openerRender(id, options, SCENE_SECONDS, leg)?.paint);


/**
 * Paint the opener a map scene asks for; false when it cannot (no trip here,
 * an opener this build lacks) — the caller then draws the series' map.
 */
export function paintStoryOpener(c: Ctx, lt: number, id: StoryOpenerId, options?: HookOptions, leg?: string | null): boolean {
  const render = openerRender(id, options, SCENE_SECONDS, leg);
  if (!render?.paint) return false;
  render.paint(c, openerClock(lt, render.seconds, SCENE_SECONDS), { width: 1080, height: 1920 });
  return true;
}
