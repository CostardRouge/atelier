import { useEffect, useState } from 'react';
import { H, W } from '../../shared/story/charte';
import type { ComposeOptions } from '../../shared/story/compose';
import { drawEpisode } from '../../shared/story/compose';
import type { Episode } from '../../shared/story/episode';
import { hookFit } from '../../shared/story/scenes/HookBadge';
import { faceSpecs, facesUsed, preflight, type InkBox, type PreflightInput, type PreflightIssue } from '../../shared/story/preflight';
import { STORY_FONTS } from '../../shared/story/fonts';
import { objectLabel, type ObjectTrack, type SceneSpan } from '../../shared/story/studio';
import type { StoryScript } from '../../shared/story/story-script';
import type { SafeZonePreset } from '../../shared/overlay/guides';
import { boxOf } from './stage-pick';

/** At most this many frames are compared for the safe zones: a check costs well under a second. */
const MAX_SAMPLES = 48;
/** The objects whose words are checked against the platform's buttons. The map's credit is the licence's, set small at its foot on purpose. */
const SKIP = new Set(['map.credit']);

/**
 * The text objects whose ink is checked: a scene or the hook holding named
 * parts is left to its parts (its own box is theirs together, and the issue
 * names the part to move). (pure)
 */
export function inkTracks(tracks: readonly ObjectTrack[]): ObjectTrack[] {
  const text = tracks.filter((t) => t.text && !SKIP.has(t.key));
  return text.filter((t) => !text.some((o) => o !== t && o.slot === t.slot && o.key.startsWith(`${t.key}.`)));
}

/** The moments an object is looked at: soon after it lands, the middle, just before it leaves. (pure) */
export function sampleTimes(spans: readonly (readonly [number, number])[]): number[] {
  return spans.flatMap(([a, b]) => {
    const len = b - a;
    if (len < 0.2) return [(a + b) / 2];
    return [Math.min(b, a + Math.min(0.6, len / 3)), (a + b) / 2, Math.max(a, b - 0.15)];
  });
}

export interface PreflightArgs {
  on: boolean;
  episode: Episode;
  script: StoryScript | null;
  postId: string;
  opts: ComposeOptions;
  tracks: readonly ObjectTrack[];
  scenes: readonly SceneSpan[];
  ground: PreflightInput['ground'];
  wall: PreflightInput['wall'];
  zone: SafeZonePreset | null;
  fontsReady: boolean;
}

/**
 * The pre-export check (`preflight.ts`), run while the Export panel is open
 * and once the post's edits settle: each text object drawn at a few moments
 * and its INK boxed (`boxOf`, two sixth-size frames), the hook's shrink
 * measured as the frame measures it, the faces asked of the browser. Null
 * while it runs.
 */
export function usePreflight(a: PreflightArgs): PreflightIssue[] | null {
  const [issues, setIssues] = useState<PreflightIssue[] | null>(null);
  const { on, episode, script, postId, opts, tracks, scenes, ground, wall, zone, fontsReady } = a;
  useEffect(() => {
    if (!on) return;
    setIssues(null);
    const id = window.setTimeout(() => {
      const ink: InkBox[] = [];
      const samples = inkTracks(tracks).flatMap((t) => sampleTimes(t.spans).map((at) => ({ t, at })));
      const step = Math.max(1, Math.ceil(samples.length / MAX_SAMPLES));
      for (let i = 0; i < samples.length; i += step) {
        const { t, at } = samples[i];
        const box = boxOf(episode, at, opts, t.id);
        if (box) ink.push({ key: t.key, slot: t.slot, label: objectLabel(t.key), at, box });
      }
      // The hook's shrink, measured on a frame's canvas with the Studio's styles of its first second in force.
      const canvas = document.createElement('canvas');
      canvas.width = W / 4;
      canvas.height = H / 4;
      const c = canvas.getContext('2d')!;
      drawEpisode(c, episode, 0.5, { ...opts, bare: true, dry: true });
      const hookScale = hookFit(c, episode);
      const post = script?.posts[postId];
      const used = facesUsed(script?.look?.charte?.fonts, script?.look?.objects, post?.objects);
      const missingFaces = fontsReady ? used.filter((f) => !faceSpecs(f).every((s) => document.fonts.check(s))).map((f) => STORY_FONTS[f].label) : [];
      setIssues(
        preflight({
          episode,
          scenes: episode.blocks.map((_, i) => {
            const sc = scenes.find((s) => s.index === i);
            return sc ? { slot: sc.key, at: sc.cap ? sc.start + (sc.cap.a + sc.cap.b) / 2 : (sc.a + sc.b) / 2 } : null;
          }),
          ground,
          wall,
          missingFaces,
          ink,
          zone,
          hookScale,
        }),
      );
    }, 350);
    return () => window.clearTimeout(id);
  }, [on, episode, script, postId, opts, tracks, scenes, ground, wall, zone, fontsReady]);
  return on ? issues : null;
}
