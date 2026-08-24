/**
 * Handing a Road Trip hook to the Studio, as an intro SCENE.
 *
 * The workflow this closes: a clip is graded and given its telemetry overlay
 * in the Studio, a day badge is composed in Road Trip, and the two used to
 * leave as separate files to be joined on a phone. They do not have to be.
 * The badge is already an `OverlayElement[]`, the Studio already knows how to
 * hold a group of elements for the first seconds of a clip (a scene), and its
 * export already burns overlays in over a graded frame. So the bridge is a
 * translation, not a new pipeline: Road Trip writes the badge into the
 * project as the scene it always was, and ONE export carries the grade, the
 * telemetry and the hook.
 *
 * Two rules make it safe to run again and again:
 *   - everything injected is named `roadtrip:…` and belongs to the
 *     `roadtrip-hook` scene, so a second send REPLACES the first rather than
 *     stacking a second badge on the clip;
 *   - nothing else in the project is touched. A grade, a trim, the telemetry
 *     elements and the author's own intro survive a send untouched.
 *
 * What does NOT cross over: the shades. Road Trip paints gradients; a Studio
 * scene has a flat scrim, and quietly turning a bottom gradient into a full
 * veil would be a different picture. The strongest shade's colour and strength
 * become the scene's scrim, which is the honest lossy mapping — and it is
 * said out loud in the panel rather than left to be discovered.
 *
 * Pure and DOM-free.
 */

import type { OverlayElement } from '../overlay/overlay-types';
import { type Scene, type SceneScrim } from '../overlay/scenes';
import type { ProjectDoc } from '../projects/project-types';
import type { Shade } from './shades';

/** The scene a sent hook lives in. One per project: a clip has one hook. */
export const HOOK_SCENE_ID = 'roadtrip-hook';

/** Every element the bridge owns carries this prefix, and only those. */
export const HOOK_ELEMENT_PREFIX = 'roadtrip:';

export function isHookElement(el: OverlayElement): boolean {
  return el.id.startsWith(HOOK_ELEMENT_PREFIX);
}

/**
 * The flat scrim that stands in for a stack of gradients: the strongest
 * shade's colour at its own strength, or null when there is nothing to stand
 * in for. Lossy on purpose and by exactly one dimension — where the darkening
 * falls — which is the part a scene cannot express.
 */
export function scrimFromShades(shades: readonly Shade[], fade = 0.4): SceneScrim | null {
  let strongest: Shade | null = null;
  for (const shade of shades) {
    if (shade.strength <= 0) continue;
    if (!strongest || shade.strength > strongest.strength) strongest = shade;
  }
  if (!strongest) return null;
  return {
    color: strongest.color,
    // A veil over the whole frame reads far heavier than the same number in a
    // gradient that clears half of it, so it is held back deliberately.
    opacity: Math.min(1, Math.max(0, strongest.strength * 0.6)),
    fade,
  };
}

export interface HookInjection {
  scene: Scene;
  elements: OverlayElement[];
}

/**
 * The badge, translated into a scene and the elements inside it.
 *
 * Element windows become offsets WITHIN the scene (that is what a scene
 * means), so a staggered entrance keeps its stagger and an exit lands on the
 * hook's own duration rather than on the clip's end.
 */
export function hookInjection(
  badgeElements: readonly OverlayElement[],
  durationSeconds: number,
  shades: readonly Shade[] = [],
  name = 'Road Trip hook',
): HookInjection {
  const end = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 4;
  return {
    scene: {
      id: HOOK_SCENE_ID,
      name,
      start: 0,
      end,
      scrim: scrimFromShades(shades),
      // The telemetry HUD holds back while the hook runs, then fades in — the
      // studio's own behaviour for an introduction, and the reason the badge
      // and a full HUD do not fight for the same frame.
      solo: true,
      hudFade: 0.5,
    },
    elements: badgeElements.map((el) => ({
      ...el,
      id: `${HOOK_ELEMENT_PREFIX}${el.id}`,
      sceneId: HOOK_SCENE_ID,
    })),
  };
}

/**
 * A project with this hook in it, replacing any hook sent before. Everything
 * the author did in the Studio — the grade, the trim, their own elements and
 * scenes — is left exactly as it was.
 */
export function withHook(doc: ProjectDoc, injection: HookInjection): ProjectDoc {
  const kept = doc.elements.filter((el) => !isHookElement(el));
  const scenes = doc.scenes.filter((s) => s.id !== HOOK_SCENE_ID);
  return {
    ...doc,
    updatedAt: Date.now(),
    // The hook is drawn LAST so it sits over the telemetry, which is what an
    // introduction is for.
    elements: [...kept, ...injection.elements],
    scenes: [...scenes, injection.scene],
  };
}

/** The project with the hook taken back out, and nothing else changed. */
export function withoutHook(doc: ProjectDoc): ProjectDoc {
  if (!doc.elements.some(isHookElement) && !doc.scenes.some((s) => s.id === HOOK_SCENE_ID)) {
    return doc;
  }
  return {
    ...doc,
    updatedAt: Date.now(),
    elements: doc.elements.filter((el) => !isHookElement(el)),
    scenes: doc.scenes.filter((s) => s.id !== HOOK_SCENE_ID),
  };
}

/** Whether a project is currently carrying a sent hook. */
export function hasHook(doc: ProjectDoc): boolean {
  return doc.scenes.some((s) => s.id === HOOK_SCENE_ID);
}
