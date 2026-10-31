/**
 * An episode's sources, read and written through the script (pure). The
 * series names them once — one trip, one Winnow, for every post of a season
 * — and a post may override either; the numbers frozen from them follow the
 * same rule, a post's own over the series'.
 */
import type { TripDoc } from '../roadtrip/trip-types';
import type { ScriptFacts, ScriptSources, StoryScript } from './story-script';
import { chosenStages, type MapChoice } from './trip-map';

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
export function withWall(script: StoryScript, wall: ScriptSources['wall'] | null, tiles: number[]): StoryScript {
  const sources: ScriptSources = { ...(script.sources ?? {}) };
  if (wall && (wall.skip?.length || Object.keys(wall.pick ?? {}).length)) sources.wall = wall;
  else delete sources.wall;
  const facts = script.facts ? { ...script.facts, ...(tiles.length ? { tiles } : {}) } : undefined;
  if (facts && !tiles.length) delete facts.tiles;
  return { ...script, sources, ...(facts ? { facts } : {}) };
}
