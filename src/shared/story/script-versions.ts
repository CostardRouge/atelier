/**
 * The script's VERSIONS on this device (strategy R2, first step): the last
 * ten states of his script, kept as he works, to go back to — a file loaded
 * over the good one (his « j'en ai mis un autre qui était tout pourri »), a
 * slider dragged too far an hour ago, a restore he regrets. A version is not
 * one per keystroke: the newest one FOLLOWS the edits for `VERSION_EVERY_MS`
 * after it opened, then a new one opens — so ten versions cover the last
 * half hour of steady work and much longer of occasional work. Loading,
 * restoring or taking the copy kept on a Winnow always opens one, and the
 * script they replace is kept first. (pure)
 */
import type { StoryScript } from './story-script';

export const KEEP_VERSIONS = 10;
/** How long the newest version follows the edits before a new one opens. */
export const VERSION_EVERY_MS = 3 * 60_000;

/** Why a version was kept: his edits, a file loaded, a version restored, the copy taken from a Winnow, or what one of those replaced. */
export type VersionWhy = 'edits' | 'loaded' | 'restored' | 'from-winnow' | 'replaced';

export interface ScriptVersion {
  /** When it was last written (ms). */
  at: number;
  /** When it opened: the newest version follows the edits until `VERSION_EVERY_MS` after this. */
  opened: number;
  why: VersionWhy;
  series: string;
  /** The posts it holds words for. */
  posts: number;
  /** Its size as JSON, and a hash of it: two versions alike are one. */
  bytes: number;
  sig: number;
  script: StoryScript;
}

/** FNV-1a over a string, 32 bits: enough to tell two states of one script apart. (pure) */
export function signature(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A version of `script` at `at`, its JSON given when the caller already has it. (pure) */
export function versionOf(script: StoryScript, at: number, why: VersionWhy, json = JSON.stringify(script)): ScriptVersion {
  return { at, opened: at, why, series: script.series || 'Untitled series', posts: Object.keys(script.posts ?? {}).length, bytes: json.length, sig: signature(json), script };
}

/**
 * The list once `v` is kept, newest first — or null when there is nothing
 * to keep (the same state as the newest). An edit within `VERSION_EVERY_MS`
 * of the newest version's opening, itself made of edits, replaces it; any
 * other opens a new version; past `KEEP_VERSIONS` the oldest goes. (pure)
 */
export function withVersion(list: readonly ScriptVersion[], v: ScriptVersion, keep = KEEP_VERSIONS): ScriptVersion[] | null {
  const newest = list[0];
  if (newest && newest.sig === v.sig && newest.bytes === v.bytes) return null;
  if (newest && v.why === 'edits' && newest.why === 'edits' && v.at - newest.opened < VERSION_EVERY_MS && v.at >= newest.opened) {
    return [{ ...v, opened: newest.opened }, ...list.slice(1)];
  }
  return [v, ...list].slice(0, keep);
}

/** How a version is named in the list: its moment, said against now. (pure) */
export function versionWhen(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 50) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const d = new Date(at);
  const today = new Date(now);
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `today ${hm}`;
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${hm}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
}

export const WHY_LABEL: Record<VersionWhy, string> = {
  edits: 'your edits',
  loaded: 'a file loaded',
  restored: 'a version restored',
  'from-winnow': 'taken from a Winnow',
  replaced: 'before a load or restore',
};
