import { describe, expect, it } from 'vitest';
import {
  HOOK_ELEMENT_PREFIX,
  HOOK_SCENE_ID,
  ctaOutro,
  hasHook,
  hookInjection,
  isHookElement,
  isRoadtripOutro,
  scrimFromShades,
  withCtaOutro,
  withHook,
  withoutCtaOutro,
  withoutHook,
} from './hook-scene';
import { DEFAULT_CTA, type CtaSlide } from './cta-slide';
import { createShade } from './shades';
import { createTextElement, type OverlayElement } from '../overlay/overlay-types';
import { createIntroScene } from '../overlay/scenes';
import type { ProjectDoc } from '../projects/project-types';

const badge = (): OverlayElement[] => [
  { ...createTextElement(), id: 'kicker', text: 'Australia' },
  { ...createTextElement(), id: 'headline', text: '27', window: { start: 0.2, end: null } },
];

const project = (over: Partial<ProjectDoc> = {}): ProjectDoc =>
  ({
    version: 1,
    id: 'p1',
    name: 'DJI_0042',
    createdAt: 1,
    updatedAt: 1,
    elements: [{ ...createTextElement(), id: 'telemetry-alt', text: 'ALT' }],
    scenes: [],
    ...over,
  }) as unknown as ProjectDoc;

describe('hookInjection', () => {
  it('puts every element in the hook scene', () => {
    const { elements, scene } = hookInjection(badge(), 4);
    expect(scene.id).toBe(HOOK_SCENE_ID);
    for (const el of elements) expect(el.sceneId).toBe(HOOK_SCENE_ID);
  });

  it('names its elements so a second send can find them', () => {
    const { elements } = hookInjection(badge(), 4);
    expect(elements.map((e) => e.id)).toEqual([
      `${HOOK_ELEMENT_PREFIX}kicker`,
      `${HOOK_ELEMENT_PREFIX}headline`,
    ]);
    expect(elements.every(isHookElement)).toBe(true);
  });

  it('keeps the element windows, which a scene reads as offsets within it', () => {
    const { elements } = hookInjection(badge(), 4);
    expect(elements[1].window).toEqual({ start: 0.2, end: null });
  });

  it('gives the scene the hook’s own duration', () => {
    expect(hookInjection(badge(), 6).scene.end).toBe(6);
  });

  it('falls back to a sane duration rather than a zero-length scene', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hookInjection(badge(), bad).scene.end).toBeGreaterThan(0);
    }
  });

  it('holds the telemetry back while the hook runs', () => {
    expect(hookInjection(badge(), 4).scene.solo).toBe(true);
  });

  it('does not mutate the badge it was given', () => {
    const source = badge();
    hookInjection(source, 4);
    expect(source[0].id).toBe('kicker');
    expect(source[0].sceneId).toBeUndefined();
  });
});

describe('scrimFromShades', () => {
  it('is nothing when there is nothing to stand in for', () => {
    expect(scrimFromShades([])).toBeNull();
    expect(scrimFromShades([createShade({ strength: 0 })])).toBeNull();
  });

  it('takes the strongest shade’s colour', () => {
    const scrim = scrimFromShades([
      createShade({ strength: 0.2, color: '#111111' }),
      createShade({ strength: 0.8, color: '#402010' }),
    ])!;
    expect(scrim.color).toBe('#402010');
  });

  it('holds the veil back, because a flat one reads heavier than a gradient', () => {
    const scrim = scrimFromShades([createShade({ strength: 0.8 })])!;
    expect(scrim.opacity).toBeGreaterThan(0);
    expect(scrim.opacity).toBeLessThan(0.8);
  });

  it('never asks for more than opaque', () => {
    expect(scrimFromShades([createShade({ strength: 5 })])!.opacity).toBeLessThanOrEqual(1);
  });
});

describe('withHook', () => {
  it('adds the badge without touching what the Studio already had', () => {
    const doc = withHook(project(), hookInjection(badge(), 4));
    expect(doc.elements.map((e) => e.id)).toContain('telemetry-alt');
    expect(doc.elements.filter(isHookElement)).toHaveLength(2);
    expect(hasHook(doc)).toBe(true);
  });

  it('draws the hook last, over the telemetry', () => {
    const doc = withHook(project(), hookInjection(badge(), 4));
    expect(isHookElement(doc.elements[doc.elements.length - 1])).toBe(true);
  });

  it('REPLACES a hook sent before instead of stacking a second badge', () => {
    const once = withHook(project(), hookInjection(badge(), 4));
    const twice = withHook(once, hookInjection(badge(), 6));
    expect(twice.elements.filter(isHookElement)).toHaveLength(2);
    expect(twice.scenes.filter((s) => s.id === HOOK_SCENE_ID)).toHaveLength(1);
    expect(twice.scenes.find((s) => s.id === HOOK_SCENE_ID)!.end).toBe(6);
  });

  it('leaves the author’s own intro scene alone', () => {
    const withIntro = project({ scenes: [createIntroScene(3)] });
    const doc = withHook(withIntro, hookInjection(badge(), 4));
    expect(doc.scenes.map((s) => s.id)).toContain('intro');
    expect(doc.scenes).toHaveLength(2);
  });

  it('does not mutate the project it was given', () => {
    const before = project();
    const count = before.elements.length;
    withHook(before, hookInjection(badge(), 4));
    expect(before.elements).toHaveLength(count);
    expect(before.scenes).toHaveLength(0);
  });
});

describe('withoutHook', () => {
  it('takes the badge back out and leaves the rest', () => {
    const doc = withoutHook(withHook(project(), hookInjection(badge(), 4)));
    expect(doc.elements.map((e) => e.id)).toEqual(['telemetry-alt']);
    expect(hasHook(doc)).toBe(false);
  });

  it('keeps the author’s own intro', () => {
    const doc = withoutHook(
      withHook(project({ scenes: [createIntroScene(3)] }), hookInjection(badge(), 4)),
    );
    expect(doc.scenes.map((s) => s.id)).toEqual(['intro']);
  });

  it('is the same document when there was no hook — no pointless save', () => {
    const before = project();
    expect(withoutHook(before)).toBe(before);
  });
});

describe('the call to action as the project outro', () => {
  const cta = (over: Partial<CtaSlide> = {}): CtaSlide => ({
    ...DEFAULT_CTA,
    ...over,
  });

  it('lays the same card the carousel appends, prefixed as the bridge’s', () => {
    const card = ctaOutro(cta(), 9 / 16)!;
    expect(card).not.toBeNull();
    expect(card.background).toBe(DEFAULT_CTA.background);
    expect(card.elements.length).toBeGreaterThan(0);
    for (const el of card.elements) {
      expect(el.id.startsWith(HOOK_ELEMENT_PREFIX)).toBe(true);
    }
    expect(isRoadtripOutro(card)).toBe(true);
  });

  it('carries the QR as its URL, in the card’s own inks', () => {
    const card = ctaOutro(cta(), 9 / 16)!;
    expect(card.qr).toMatchObject({
      url: DEFAULT_CTA.url,
      dark: DEFAULT_CTA.ink,
      light: DEFAULT_CTA.background,
    });
  });

  it('a CTA with nothing to say makes no card — the deck’s own rule', () => {
    expect(ctaOutro(cta({ headline: ' ', body: '', url: '' }), 9 / 16)).toBeNull();
  });

  it('sends into an empty slot and replaces its own card on a resend', () => {
    const first = withCtaOutro(project(), ctaOutro(cta(), 9 / 16))!;
    expect(isRoadtripOutro(first.outro)).toBe(true);
    const second = withCtaOutro(first, ctaOutro(cta({ headline: 'Nouveau' }), 9 / 16))!;
    expect(second.outro!.elements.some((e) => e.text === 'Nouveau')).toBe(true);
  });

  it('unticking the CTA takes a sent card back out', () => {
    const sent = withCtaOutro(project(), ctaOutro(cta(), 9 / 16))!;
    const cleared = withCtaOutro(sent, null)!;
    expect(cleared.outro).toBeNull();
  });

  it('never overwrites an outro the author composed themselves', () => {
    const own = project({
      outro: { seconds: 3, background: '#000', elements: [], qr: null },
    } as Partial<ProjectDoc>);
    expect(withCtaOutro(own, ctaOutro(cta(), 9 / 16))).toBeNull();
    // …and unticking the CTA leaves it alone rather than deleting it.
    expect(withCtaOutro(own, null)).toBe(own);
    expect(withoutCtaOutro(own)).toBe(own);
  });

  it('unlinking strips only the bridge’s card', () => {
    const sent = withCtaOutro(project(), ctaOutro(cta(), 9 / 16))!;
    expect(withoutCtaOutro(sent).outro).toBeNull();
    const untouched = project();
    expect(withoutCtaOutro(untouched)).toBe(untouched);
  });
});
