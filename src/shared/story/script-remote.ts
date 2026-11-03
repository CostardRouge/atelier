/**
 * The script KEPT ON A WINNOW (strategy R2, second step; his « le script
 * gardé sur ton Winnow pour qu'il suive d'un appareil à l'autre »): the same
 * document bucket and the same conflict-safe writes as a trip — `kind:
 * 'story'`, the whole script as the body (his words, the sources' NAMES and
 * the counted facts; no media, the wall's pictures are ids), a small summary
 * beside it so a list of series costs nothing. The Winnow copy is the
 * authority once kept; this browser's copy is its mirror, and its versions
 * (`script-versions.ts`) the net under both. (pure)
 */
import { SCRIPT_ID, type StoryScript } from './story-script';

/** The kind a series' script is filed under in a Winnow's bucket (Winnow's `DOC_KINDS`). */
export const STORY_DOC_KIND = 'story';
/** The body's own version on the wire: the script's. */
export const STORY_DOC_VERSION = 1;

export interface ScriptSummary {
  series: string;
  lang: 'en' | 'fr';
  /** The posts it holds words for. */
  posts: number;
  /** The trip its maps follow, by name, when it names one. */
  trip?: string;
}

/** What the list of kept series shows for one. (pure) */
export function scriptSummary(script: StoryScript): ScriptSummary {
  const trip = script.sources?.trip?.name;
  return {
    series: script.series || 'Untitled series',
    lang: script.lang === 'en' ? 'en' : 'fr',
    posts: Object.keys(script.posts ?? {}).length,
    ...(trip ? { trip } : {}),
  };
}

/** A summary read back from an instance, or null when it is not one. (pure) */
export function readScriptSummary(raw: unknown): ScriptSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.series !== 'string' || typeof r.posts !== 'number') return null;
  return {
    series: r.series,
    lang: r.lang === 'en' ? 'en' : 'fr',
    posts: r.posts,
    ...(typeof r.trip === 'string' ? { trip: r.trip } : {}),
  };
}

/** A new id for a series: random, URL-safe, never derived from his words. (pure over `random`) */
export function mintScriptId(random: () => string = () => crypto.randomUUID()): string {
  const id = `story-${random()}`.replace(/[^A-Za-z0-9._-]/g, '');
  return SCRIPT_ID.test(id) ? id : `story-${Date.now().toString(36)}`;
}

/** The script with an id, minted when it has none. (pure over `mint`) */
export function withScriptId(script: StoryScript, mint: () => string = mintScriptId): StoryScript {
  return script.id && SCRIPT_ID.test(script.id) ? script : { ...script, id: mint() };
}
