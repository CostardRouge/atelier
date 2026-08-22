/**
 * The Intro palette group — pure data, DOM-free.
 *
 * These cells are **presets, not kinds**: a hook title and a subtitle are both
 * ordinary text elements, they differ by size, placement, window and entrance.
 * Keeping them as presets is what lets the intro reuse everything an overlay
 * element already has (the style cascade, the theme, dragging, the burn-in
 * export) instead of growing a second class of element beside it.
 *
 * Every preset lands in the intro scene, so it borrows that scene's clock and
 * can be moved as a block — the element windows below are offsets *inside* the
 * scene, never absolute times (see scenes.ts).
 */

import type { OverlayElement } from './overlay-types';
import { createRotateDeviceElement, createTextElement } from './overlay-types';
import { INTRO_SCENE_ID } from './scenes';

export type IntroPresetId = 'hook-title' | 'subtitle' | 'question' | 'rotate-phone';

export interface IntroPreset {
  id: IntroPresetId;
  /** Cell name — short, it sits over a third of a 340px column. */
  label: string;
  create: () => OverlayElement;
}

/** Hook title: the statement, centred, arriving from below. */
function hookTitle(): OverlayElement {
  const el = createTextElement('Your hook here');
  el.anchor = 'center';
  el.x = 0.5;
  el.y = 0.42;
  el.sizeFrac = 0.085;
  el.weight = 700;
  el.sceneId = INTRO_SCENE_ID;
  el.window = { start: 0, end: null };
  el.animation = {
    in: { preset: 'slide', duration: 0.6, easing: 'out', direction: 'up', distanceFrac: 0.05 },
    out: { preset: 'fade', duration: 0.45, easing: 'in' },
  };
  return el;
}

/** Subtitle: the second line, entering after the title has landed. */
function subtitle(): OverlayElement {
  const el = createTextElement('the line underneath');
  el.anchor = 'center';
  el.x = 0.5;
  el.y = 0.52;
  el.sizeFrac = 0.036;
  el.weight = 500;
  el.sceneId = INTRO_SCENE_ID;
  el.window = { start: 0.45, end: null };
  el.animation = {
    in: { preset: 'fade', duration: 0.5, easing: 'out' },
    out: { preset: 'fade', duration: 0.35, easing: 'in' },
  };
  return el;
}

/** Question: typed out rather than faded in — the reveal IS the hook. */
function question(): OverlayElement {
  const el = createTextElement('What if you could…?');
  el.anchor = 'center';
  el.x = 0.5;
  el.y = 0.45;
  el.sizeFrac = 0.062;
  el.weight = 600;
  el.sceneId = INTRO_SCENE_ID;
  el.window = { start: 0, end: null };
  el.animation = {
    in: { preset: 'typewriter', duration: 1.1, easing: 'linear' },
    out: { preset: 'fade', duration: 0.4, easing: 'in' },
  };
  return el;
}

/** The invitation to turn the phone, held a little longer than a title. */
function rotatePhone(): OverlayElement {
  const el = createRotateDeviceElement();
  el.sceneId = INTRO_SCENE_ID;
  el.window = { start: 0.2, end: null };
  el.animation = {
    in: { preset: 'scale', duration: 0.45, easing: 'out', scaleFrom: 0.8 },
    out: { preset: 'fade', duration: 0.4, easing: 'in' },
  };
  return el;
}

export const INTRO_PRESETS: readonly IntroPreset[] = [
  { id: 'hook-title', label: 'Hook title', create: hookTitle },
  { id: 'subtitle', label: 'Subtitle', create: subtitle },
  { id: 'question', label: 'Question', create: question },
  { id: 'rotate-phone', label: 'Rotate phone', create: rotatePhone },
];

export function introPreset(id: IntroPresetId): IntroPreset {
  const found = INTRO_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown intro preset: ${id}`);
  return found;
}
