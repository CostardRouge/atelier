/**
 * What the Studio reads off a post (pure): its OBJECTS over time — which the
 * tree lists and the timeline draws as tracks — learnt by running the post
 * on a context that draws nothing (`null-context.ts`), frame after frame,
 * and the names it shows for them.
 */
import { drawEpisode, type ComposeOptions } from './compose';
import { slotsOf, totalSeconds, type Episode } from './episode';
import { nullContext } from './null-context';
import { drawnObjects } from './objects';

/** One object of a post and the stretches of time it is on the stage, seconds. */
export interface ObjectTrack {
  id: string;
  key: string;
  /** Its slot's key (`compose.ts`), '' for what sits over every slot. */
  slot: string;
  text: boolean;
  spans: [number, number][];
}

/** Every object a post draws, in the order first drawn, each with when it is on the stage, to `step` seconds. */
export function objectTracks(ep: Episode, opts: ComposeOptions = {}, step = 0.1): ObjectTrack[] {
  const c = nullContext();
  const total = totalSeconds(ep);
  const tracks = new Map<string, ObjectTrack>();
  const n = Math.ceil(total / step);
  for (let i = 0; i <= n; i++) {
    const t = Math.min(total - 0.001, i * step);
    drawEpisode(c, ep, t, { ...opts, dry: true });
    for (const d of drawnObjects()) {
      let tr = tracks.get(d.id);
      if (!tr) tracks.set(d.id, (tr = { id: d.id, key: d.key, slot: d.slot, text: false, spans: [] }));
      tr.text ||= d.text;
      const last = tr.spans[tr.spans.length - 1];
      if (last && t - last[1] <= step * 1.5) last[1] = t;
      else tr.spans.push([t, t]);
    }
  }
  return [...tracks.values()];
}

/** A post's scenes as the timeline draws them: each slot's key, block, index among the post's blocks, and seconds. */
export function sceneSpans(ep: Episode): { key: string; block: string; index: number | null; a: number; b: number }[] {
  const slots = slotsOf(ep);
  // The opening (title) and the ending (recap) are the post's own, not one of its blocks.
  const first = ep.hook ? 0 : 1;
  return slots.map((s, i) => ({ key: s.key, block: s.block, index: i >= first && i < first + ep.blocks.length ? i - first : null, a: s.a, b: s.b }));
}

const BLOCK_LABEL: Record<string, string> = {
  intro: 'Title',
  wall: 'Wall',
  'map-camera': 'Map',
  folders: 'Folders',
  recap: 'Next episode',
  'recap-carte': 'Closing card',
  counter: 'Counter',
  'before-after': 'Before / after',
  app: 'App',
  gear: 'Gear',
  transfer: 'Transfer',
  clocks: 'Clocks',
  'journey-impossible': 'Impossible journey',
  'map-holes': 'Map with holes',
  names: 'Names',
  bursts: 'Bursts',
  'card-recovery': 'Card recovery',
  'season-recap': 'Season recap',
};
const PART_LABEL: Record<string, string> = { caption: 'Caption', hud: 'HUD', hook: 'Hook' };

/** How the Studio names an object by its key: a scene by its block, a part by its last name. */
export function objectLabel(key: string): string {
  if (PART_LABEL[key]) return PART_LABEL[key];
  const dot = key.indexOf('.');
  if (dot < 0) return BLOCK_LABEL[key] ?? key;
  const part = key.slice(key.lastIndexOf('.') + 1).replace(/-/g, ' ');
  return part.charAt(0).toUpperCase() + part.slice(1);
}
