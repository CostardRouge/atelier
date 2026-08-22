/**
 * Scenes — a shared lifetime for a group of elements. Pure and DOM-free.
 *
 * The founding case is the introduction of a social clip: a hook title, maybe
 * a subtitle, maybe an invitation to turn the phone, all living for the first
 * few seconds and then leaving together. Rather than a second class of element
 * (which would need its own styling, palette, panel, renderer and export), a
 * scene is a *window with furniture*: the elements inside it are ordinary
 * overlay elements, they simply borrow the scene's clock and can dim what is
 * not part of it.
 *
 * Two pieces of furniture, both optional and independent:
 * - a **scrim**, painted over the picture and under every element, which is
 *   what makes a title readable over any footage;
 * - **solo**, which holds back the elements that are not in the scene and
 *   fades them in when it ends, so the telemetry HUD "boots up" after the hook.
 *
 * Element windows inside a scene are **relative to the scene**, so moving the
 * intro moves everything staggered inside it.
 */

import type { TimeWindow } from './animation';
import type { OverlayElement } from './overlay-types';

export interface SceneScrim {
  /** Any CSS colour the canvas understands. */
  color: string;
  /** 0..1 at full strength. */
  opacity: number;
  /** Seconds the scrim takes to arrive and to leave. */
  fade: number;
}

export interface Scene {
  id: string;
  /** Shown in the inspector; never rendered. */
  name: string;
  /** Seconds from the first exported frame. */
  start: number;
  end: number;
  scrim: SceneScrim | null;
  /** Hold back every element that is not in this scene while it runs. */
  solo: boolean;
  /** Seconds the held-back elements take to fade out and back in. 0 = a cut. */
  hudFade: number;
}

/** The id the studio gives its one scene today; the model already takes N. */
export const INTRO_SCENE_ID = 'intro';

export function createIntroScene(end = 3): Scene {
  return {
    id: INTRO_SCENE_ID,
    name: 'Introduction',
    start: 0,
    end,
    scrim: null,
    solo: false,
    hudFade: 0.5,
  };
}

export function findScene(
  scenes: readonly Scene[] | undefined,
  id: string | null | undefined,
): Scene | null {
  if (!scenes || !id) return null;
  return scenes.find((s) => s.id === id) ?? null;
}

/**
 * The absolute window an element is on screen for.
 *
 * Outside a scene it is the element's own window (absent = the whole clip).
 * Inside one, its window is an offset *within* the scene, clamped to it: the
 * scene owns when the group lives, the element only says where in that span it
 * takes its turn.
 */
export function resolveWindow(
  el: OverlayElement,
  scene: Scene | null,
): TimeWindow | null {
  if (!scene) return el.window ?? null;
  const start = scene.start + Math.max(0, el.window?.start ?? 0);
  const rel = el.window?.end;
  const end = rel == null ? scene.end : Math.min(scene.end, scene.start + rel);
  return { start: Math.min(start, end), end };
}

/** How far into a fade of `span` seconds `t` sits, 0..1 (1 when span is 0). */
function ramp(t: number, span: number): number {
  // A zero-length fade is a step, not a constant: without the guard a scrim
  // with no fade would read as "fully out" from the first frame.
  if (span <= 0) return t >= 0 ? 1 : 0;
  const p = t / span;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export interface SceneRender {
  /** Colour + live opacity of the scrim to paint, or null. */
  scrim: { color: string; opacity: number } | null;
  /** Alpha multiplier for every element that belongs to no scene. */
  outsideAlpha: number;
}

const NO_SCENES: SceneRender = { scrim: null, outsideAlpha: 1 };

/**
 * What the scene layer contributes at time `t` (seconds from the first
 * exported frame): the scrim's current strength, and how visible the elements
 * outside every scene are.
 *
 * With several scenes the strongest scrim and the dimmest `outsideAlpha` win —
 * overlapping scenes are unusual, and the alternative (adding their veils up
 * to something opaque) is never what an author means.
 */
export function resolveScenes(
  scenes: readonly Scene[] | undefined,
  t: number,
): SceneRender {
  if (!scenes || scenes.length === 0) return NO_SCENES;
  let scrim: { color: string; opacity: number } | null = null;
  let outsideAlpha = 1;

  for (const scene of scenes) {
    const len = scene.end - scene.start;
    if (len <= 0) continue;

    if (scene.scrim && t > scene.start - scene.scrim.fade && t < scene.end + scene.scrim.fade) {
      const fade = Math.min(scene.scrim.fade, len / 2);
      const rise = ramp(t - scene.start, fade);
      const fall = 1 - ramp(t - (scene.end - fade), fade);
      const strength = Math.max(0, Math.min(rise, fall));
      const opacity = scene.scrim.opacity * strength;
      if (opacity > 0 && (!scrim || opacity > scrim.opacity)) {
        scrim = { color: scene.scrim.color, opacity };
      }
    }

    if (scene.solo) {
      // Held back from `hudFade` before the scene opens, back to full `hudFade`
      // after it closes — one knob, both directions, so an intro that does not
      // start at zero doesn't snap the HUD off screen.
      const before = 1 - ramp(t - (scene.start - scene.hudFade), scene.hudFade);
      const after = ramp(t - scene.end, scene.hudFade);
      const alpha = t < scene.start ? before : t >= scene.end ? after : 0;
      outsideAlpha = Math.min(outsideAlpha, Math.max(0, alpha));
    }
  }
  return { scrim, outsideAlpha };
}
