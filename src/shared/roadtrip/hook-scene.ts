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
import { OUTRO_SECONDS_DEFAULT, type OutroCard } from '../overlay/outro-card';
import { type Scene, type SceneScrim } from '../overlay/scenes';
import type { ProjectDoc } from '../projects/project-types';
import { ctaLayout, type CtaSlide } from './cta-slide';
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

// --- the call to action, as the project's OUTRO ----------------------------
//
// The closing card crosses the same bridge the hook does, into the Studio's
// own outro slot (`shared/overlay/outro-card.ts`): the card the carousel
// export appends as its last slide becomes, on a reel, the card the video
// export appends after the footage. Same translation discipline — everything
// injected is `roadtrip:`-prefixed so a resend replaces rather than stacks,
// and an outro the author composed THEMSELVES in the Studio is never touched:
// "nothing else in the project is touched" covers their outro too, and the
// panel says so instead of silently overwriting it.

/** True when a project's outro is one this bridge put there. */
export function isRoadtripOutro(outro: OutroCard | null | undefined): boolean {
  return !!outro && outro.elements.some((el) => el.id.startsWith(HOOK_ELEMENT_PREFIX));
}

/**
 * The trip's call to action as an outro card, laid out for the piece's own
 * frame — the same `ctaLayout` the carousel's closing slide uses, so the two
 * cards are the same card. Null when the CTA has nothing to say: a blank
 * end card is worse than none (the deck's own rule).
 */
export function ctaOutro(
  cta: CtaSlide,
  aspect: number,
  seconds: number = OUTRO_SECONDS_DEFAULT,
): OutroCard | null {
  if (!cta.headline.trim() && !cta.body.trim() && !cta.url.trim()) return null;
  const layout = ctaLayout(cta, aspect);
  const qr = layout.qr
    ? {
        url: cta.url.trim(),
        x: layout.qr.x,
        y: layout.qr.y,
        sizeFrac: layout.qr.sizeFrac,
        dark: cta.ink,
        light: cta.background,
      }
    : null;
  return {
    seconds,
    background: cta.background,
    elements: layout.elements.map((el) => ({
      ...el,
      id: `${HOOK_ELEMENT_PREFIX}${el.id}`,
    })),
    qr,
  };
}

/**
 * A project with this call-to-action outro — replacing one this bridge sent
 * before, or filling an empty slot. `card` null means the author unticked the
 * CTA: a previously sent card is taken back out. Returns null instead of a
 * document when the project carries an outro of its OWN, which a send must
 * not overwrite — the caller says so in the panel.
 */
export function withCtaOutro(
  doc: ProjectDoc,
  card: OutroCard | null,
): ProjectDoc | null {
  // `?? null`: a document from before the field existed reads as empty, the
  // same answer the migration gives it.
  const current = doc.outro ?? null;
  const foreign = current !== null && !isRoadtripOutro(current);
  if (foreign) return card === null ? doc : null;
  if (card === null && current === null) return doc;
  return { ...doc, updatedAt: Date.now(), outro: card };
}

/** The project without a bridge-sent outro; the author's own is left alone. */
export function withoutCtaOutro(doc: ProjectDoc): ProjectDoc {
  if (!isRoadtripOutro(doc.outro ?? null)) return doc;
  return { ...doc, updatedAt: Date.now(), outro: null };
}

/** Whether a project is currently carrying a sent hook. */
export function hasHook(doc: ProjectDoc): boolean {
  return doc.scenes.some((s) => s.id === HOOK_SCENE_ID);
}
