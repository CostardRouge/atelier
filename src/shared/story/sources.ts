/**
 * An episode's sources, read and written through the script (pure). The
 * series names them once — one trip, one Winnow, for every post of a season
 * — and a post may override either; the numbers frozen from them follow the
 * same rule, a post's own over the series'.
 */
import type { TripDoc } from '../roadtrip/trip-types';
import type { ScriptFacts, ScriptSources, StoryScript } from './story-script';

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
  const same = JSON.stringify(next) === JSON.stringify(script.sources ?? {});
  const out: StoryScript = { ...script };
  delete out.sources;
  delete out.facts;
  if (next.trip || next.winnow) out.sources = next;
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
