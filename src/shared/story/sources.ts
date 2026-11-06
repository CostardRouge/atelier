/**
 * An episode's sources, read and written through the script (pure). The
 * series names them once — one trip, one Winnow, for every post of a season
 * — and a post may override either; the numbers frozen from them follow the
 * same rule, a post's own over the series'.
 */
import { CAPTION_LOOK_DEFAULTS, type CaptionLook } from './caption-layout';
import type { WallRules } from './wall-pick';
import { MAP_GROUND_DEFAULTS, type MapGround } from './map-ground';
import type { StoryCamera } from './story-camera';
import { ROUTE_PACE_DEFAULTS, type RoutePace } from './route-pace';
import type { HookBadge } from './hook-badge';
import type { TripDoc } from '../roadtrip/trip-types';
import { MAX_CHOSEN, type ScriptFacts, type ScriptPost, type ScriptSources, type StoryScript } from './story-script';
import { chosenStages, stageLabel, type MapChoice } from './trip-map';
import { thinEvenly, type WallPick } from './story-facts';
import { TEXTURE } from './charte';
import type { StoryLook } from './episode';
import { WALL_DEFAULTS, type WallGrid, type WallStage } from './wall-grid';

/** The sources a post reads: its own fields over the series'. */
export function sourcesOf(script: StoryScript | null, postId: string): ScriptSources {
  const series = script?.sources ?? {};
  const own = script?.posts[postId]?.sources ?? {};
  return { ...series, ...own };
}

/** The numbers a post reads: its own when it was counted alone, else the series'. */
export function factsOf(script: StoryScript | null, postId: string): ScriptFacts | null {
  return script?.posts[postId]?.facts ?? script?.facts ?? null;
}

/**
 * The script with the SERIES' sources changed — a field set to null is
 * removed. Changing a source drops the facts it counted: they no longer say
 * where they came from.
 */
export function withSeriesSources(script: StoryScript, change: { [K in keyof ScriptSources]?: ScriptSources[K] | null }): StoryScript {
  const next: ScriptSources = { ...(script.sources ?? {}) };
  for (const key of Object.keys(change) as (keyof ScriptSources)[]) {
    const value = change[key];
    if (value === null) delete next[key];
    else if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  // The map's names are drawn, not counted: changing them keeps the numbers.
  const counted = (s: ScriptSources) => JSON.stringify({ trip: s.trip ?? null, winnow: s.winnow ?? null, days: s.days ?? null });
  const same = counted(next) === counted(script.sources ?? {});
  const out: StoryScript = { ...script };
  delete out.sources;
  delete out.facts;
  if (next.trip || next.winnow || next.map || next.days) out.sources = next;
  if (same && script.facts) out.facts = script.facts;
  return out;
}

/** What a trip carries for a map, in one line: its days, stages, named places and road. */
export function tripLine(trip: TripDoc): string {
  const places = trip.stages.reduce((n, s) => n + s.places.length, 0);
  const parts = [
    `${trip.startDate} → ${trip.endDate}`,
    `${trip.stages.length} stage${trip.stages.length === 1 ? '' : 's'}`,
    `${places} place${places === 1 ? '' : 's'}`,
    trip.road ? `a road of ${trip.road.fixes.toLocaleString('en-GB')} fixes` : 'no road yet',
  ];
  return parts.join(' · ');
}

/** The script with the series' numbers replaced by a new counting. */
export function withSeriesFacts(script: StoryScript, facts: ScriptFacts): StoryScript {
  return { ...script, facts };
}

/** The map a series chooses, read from its sources (`trip-map.ts`'s `MapChoice`). */
export function mapChoiceOf(sources: ScriptSources): MapChoice {
  return { ...(sources.trip?.stages ? { stages: sources.trip.stages } : {}), ...(sources.map ?? {}) };
}

/** The days a series counts, as `story-facts.ts` reads them: a first and last day, and days left out. */
export interface CountedSpan {
  from: string;
  to: string;
  skip?: readonly string[];
}

/** The days its kept stages cover: their first to last day, else the trip's whole span. */
export function stagesSpan(trip: TripDoc, sources: ScriptSources): { from: string; to: string } {
  const choice = mapChoiceOf(sources);
  const stages = chosenStages(trip, choice);
  if (!choice.stages || !stages.length) return { from: trip.startDate, to: trip.endDate };
  return {
    from: stages.reduce((m, s) => (s.startDate < m ? s.startDate : m), stages[0].startDate),
    to: stages.reduce((m, s) => (s.endDate > m ? s.endDate : m), stages[0].endDate),
  };
}

/** The days a series counts: its own first and last day and the days it leaves out, over its kept stages' span. */
export function countedSpan(trip: TripDoc, sources: ScriptSources): CountedSpan {
  const base = stagesSpan(trip, sources);
  const from = sources.days?.from ?? base.from;
  const to = sources.days?.to ?? base.to;
  const skip = (sources.days?.skip ?? []).filter((d) => d >= from && d <= to);
  return { from, to, ...(skip.length ? { skip } : {}) };
}

/**
 * The script with the wall chosen by hand: the choice kept in the series'
 * sources (so the next counting keeps it) and the pictures it gives frozen
 * at once, the other numbers untouched — what was hidden or picked is drawn,
 * not counted.
 */
export function withWall(script: StoryScript, wall: ScriptSources['wall'] | null, picks: readonly WallPick[]): StoryScript {
  // The pictures ticked in the picker are kept: a hidden one or a day's pick does not undo them.
  const chosen = script.sources?.wall?.chosen;
  return withWallSources(script, { ...(wall ?? {}), ...(chosen ? { chosen } : {}) }, picks);
}

/**
 * The script with the pictures ticked in the Winnow picker as the wall's
 * pool (`chosen`, thinned evenly to `MAX_CHOSEN` over their days), or with
 * none — the wall back to one cover a day. `picks`, when given, freezes the
 * wall's pictures at once; without them the next counting does.
 */
export function withChosenWall(script: StoryScript, chosen: readonly (readonly [number, string])[] | null, picks: readonly WallPick[] | null): StoryScript {
  const was = script.sources?.wall ?? {};
  const pool = chosen?.length ? thinEvenly([...chosen].sort((a, b) => a[1].localeCompare(b[1])), MAX_CHOSEN).map((c): [number, string] => [c[0], c[1]]) : null;
  const wall: NonNullable<ScriptSources['wall']> = { ...was };
  if (pool) wall.chosen = pool;
  else delete wall.chosen;
  return withWallSources(script, wall, picks);
}

/**
 * The script with the wall chosen by rules (`wall-pick.ts`): `rules` (null =
 * back to one a day, his pins and his frozen order dropped with them), his
 * `pin`s and removed pictures (`skip`) as given, the wall frozen in his
 * `order` (`wall-correct.ts`; null = the rules choose again), the rest of the
 * wall kept. `picks`, when given, freezes the wall's pictures at once.
 */
export function withWallRules(
  script: StoryScript,
  patch: { rules?: WallRules | null; pin?: readonly number[]; skip?: readonly number[]; order?: readonly (readonly [number, string])[] | null },
  picks: readonly WallPick[] | null,
): StoryScript {
  const wall: NonNullable<ScriptSources['wall']> = { ...(script.sources?.wall ?? {}) };
  if (patch.rules === null) {
    delete wall.rules;
    delete wall.pin;
    delete wall.order;
  } else if (patch.rules) wall.rules = patch.rules;
  if (patch.order !== undefined) {
    if (patch.order?.length && wall.rules) wall.order = patch.order.map((e): [number, string] => [e[0], e[1]]);
    else delete wall.order;
  }
  if (patch.pin) {
    if (patch.pin.length) wall.pin = [...patch.pin];
    else delete wall.pin;
  }
  if (patch.skip) {
    if (patch.skip.length) wall.skip = [...patch.skip];
    else delete wall.skip;
  }
  return withWallSources(script, wall, picks);
}

function withWallSources(script: StoryScript, wall: NonNullable<ScriptSources['wall']>, picks: readonly WallPick[] | null): StoryScript {
  const sources: ScriptSources = { ...(script.sources ?? {}) };
  if (wall.skip?.length || Object.keys(wall.pick ?? {}).length || wall.chosen?.length || wall.rules || wall.pin?.length) sources.wall = wall;
  else delete sources.wall;
  return { ...script, sources, ...(script.facts && picks ? { facts: withTiles(script.facts, picks) } : {}) };
}

/** Facts with the wall's pictures (and their days) replaced; none takes the wall's pictures away. */
export function withTiles(facts: ScriptFacts, picks: readonly WallPick[]): ScriptFacts {
  const next: ScriptFacts = { ...facts };
  delete next.tiles;
  delete next.tileDays;
  if (picks.length) {
    next.tiles = picks.map((p) => p.id);
    next.tileDays = picks.map((p) => p.day);
  }
  return next;
}

/** The kept stages as counting freezes them for a wall grouped by stage: their names and days, in date order. */
export function countedStages(trip: TripDoc, sources: ScriptSources): WallStage[] {
  return chosenStages(trip, mapChoiceOf(sources)).map((s) => ({ label: stageLabel(s), from: s.startDate, to: s.endDate }));
}

/**
 * The script with one post's hooks changed (`hook.ts`): its variants, which
 * one plays, and its promise. An empty list takes the hook away — the post
 * opens on its title again.
 */
export function withPostHooks(
  script: StoryScript,
  postId: string,
  change: { hooks?: ScriptPost['hooks']; hookActive?: number; promise?: string },
): StoryScript {
  const post: ScriptPost = { ...(script.posts[postId] ?? {}) };
  if (change.hooks !== undefined) {
    if (change.hooks.length) post.hooks = change.hooks;
    else {
      delete post.hooks;
      delete post.hookActive;
    }
  }
  if (change.hookActive !== undefined && post.hooks?.length) post.hookActive = Math.min(post.hooks.length - 1, Math.max(0, change.hookActive));
  if (change.promise !== undefined) {
    if (change.promise.trim()) post.promise = change.promise;
    else delete post.promise;
  }
  return { ...script, posts: { ...script.posts, [postId]: post } };
}

/**
 * The script with the series' look changed (`wall-grid.ts`, `StoryLook`): a
 * field set back to its default is removed, so a script keeps only what was
 * chosen, and an empty look leaves no trace.
 */
export function withLook(
  script: StoryScript,
  change: { wall?: Partial<WallGrid>; vignette?: number | null; grain?: number | null; map?: Partial<MapGround>; camera?: StoryCamera | null; pace?: Partial<RoutePace>; hook?: HookBadge | null; captions?: Partial<CaptionLook> | null } | null,
): StoryScript {
  if (!change) {
    // Only what the Look section sets: the charte and the objects have their own resets.
    const kept: StoryLook = { ...(script.look ?? {}) };
    delete kept.wall;
    delete kept.vignette;
    delete kept.grain;
    delete kept.map;
    delete kept.camera;
    delete kept.pace;
    delete kept.hook;
    delete kept.wallMotion;
    delete kept.captions;
    const rest: StoryScript = { ...script, look: kept };
    if (!Object.keys(kept).length) delete rest.look;
    return rest;
  }
  const was = script.look ?? {};
  const wall: Partial<WallGrid> = { ...(was.wall ?? {}), ...(change.wall ?? {}) };
  for (const k of Object.keys(wall) as (keyof WallGrid)[]) if (wall[k] === WALL_DEFAULTS[k]) delete wall[k];
  const look: StoryLook = { ...was, ...(Object.keys(wall).length ? { wall } : {}) };
  if (!Object.keys(wall).length) delete look.wall;
  if (change.camera !== undefined) {
    // « As before » is the absence of a camera: a series that never chose keeps the old path.
    if (change.camera === null || (change.camera.preset ?? 'before') === 'before') delete look.camera;
    else look.camera = change.camera.preset === 'own' ? change.camera : { preset: change.camera.preset };
  }
  if (change.hook !== undefined) {
    // The hook's look is written whole; empty (or null) is Or ciné in the stack, his default.
    if (change.hook && Object.keys(change.hook).length) look.hook = change.hook;
    else delete look.hook;
  }
  if (change.pace) {
    const pace: RoutePace = { ...(was.pace ?? {}), ...change.pace };
    for (const k of Object.keys(pace) as (keyof RoutePace)[]) if (pace[k] === undefined || pace[k] === ROUTE_PACE_DEFAULTS[k]) delete pace[k];
    if (Object.keys(pace).length) look.pace = pace;
    else delete look.pace;
  }
  if (change.captions !== undefined) {
    const captions: Partial<CaptionLook> = change.captions === null ? {} : { ...(was.captions ?? {}), ...change.captions };
    for (const k of Object.keys(captions) as (keyof CaptionLook)[]) if (captions[k] === undefined || captions[k] === CAPTION_LOOK_DEFAULTS[k]) delete captions[k];
    if (Object.keys(captions).length) look.captions = captions;
    else delete look.captions;
  }
  if (change.map) {
    // A field set back to its default is dropped, so a script keeps only what was chosen.
    const map: MapGround = { ...(was.map ?? {}), ...change.map };
    for (const k of Object.keys(map) as (keyof MapGround)[]) if (map[k] === undefined || map[k] === MAP_GROUND_DEFAULTS[k]) delete map[k];
    if (Object.keys(map).length) look.map = map;
    else delete look.map;
  }
  for (const k of ['vignette', 'grain'] as const) {
    const v = change[k];
    if (v === undefined) continue;
    if (v === null || v === TEXTURE[k]) delete look[k];
    else look[k] = v;
  }
  const next: StoryScript = { ...script, look };
  if (!Object.keys(look).length) delete next.look;
  return next;
}
