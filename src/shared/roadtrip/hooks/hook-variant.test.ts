import { describe, expect, it } from 'vitest';
import type { BadgeContent } from '../day-badge';
import {
  DEFAULT_HOOK_ID,
  defaultHookLayers,
  foldHook,
  readOptions,
  type HookContext,
  type HookRender,
} from './hook-variant';
import { HOOK_VARIANTS, hookVariantById, resolveHook } from './registry';

const CONTENT: BadgeContent = {
  kicker: 'Australia',
  label: 'Day',
  headline: '27',
  counter: 'of 104',
  caption: 'in Karijini',
  timing: '515 days ago',
};

const CTX: HookContext = {
  aspect: 9 / 16,
  durationSeconds: 4,
  date: '2025-04-17',
  content: CONTENT,
};

function render(partial: Partial<HookRender> & { seconds?: number }): HookRender {
  return { seconds: 0, ...partial };
}

describe('defaults', () => {
  it('starts every piece on the badge, as a list of one', () => {
    expect(defaultHookLayers()).toEqual([{ id: DEFAULT_HOOK_ID, options: {} }]);
  });

  it('hands back a fresh list, so one piece cannot alias another', () => {
    const a = defaultHookLayers();
    const b = defaultHookLayers();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('merges stored options over a variant’s defaults', () => {
    expect(readOptions({ mode: 'run-up' }, { mode: 'from-start', stops: 12 })).toEqual({
      mode: 'run-up',
      stops: 12,
    });
  });
});

describe('the registry', () => {
  it('holds the badge, and every entry has a unique id', () => {
    expect(hookVariantById(DEFAULT_HOOK_ID)).toBeDefined();
    const ids = HOOK_VARIANTS.map((variant) => variant.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the badge drawing and saying exactly nothing', () => {
    const hook = resolveHook(defaultHookLayers(), CTX);
    expect(hook.seconds).toBe(0);
    expect(hook.ownsFrame).toBe(false);
    expect(hook.contentAt(CONTENT, 0)).toEqual(CONTENT);
    expect(hook.score()).toEqual([]);
  });
});

describe('resolveHook', () => {
  it('skips an id this build does not know', () => {
    const hook = resolveHook(
      [{ id: 'from-a-newer-build', options: { anything: 1 } }],
      CTX,
    );
    expect(hook.seconds).toBe(0);
    expect(hook.contentAt(CONTENT, 0)).toEqual(CONTENT);
  });

  it('falls back to the badge when nothing resolves', () => {
    expect(resolveHook([], CTX).contentAt(CONTENT, 0)).toEqual(CONTENT);
    expect(resolveHook(undefined, CTX).contentAt(CONTENT, 0)).toEqual(CONTENT);
  });
});

describe('foldHook', () => {
  it('takes the longest layer’s life', () => {
    const hook = foldHook([render({ seconds: 1.2 }), render({ seconds: 2.4 })], false);
    expect(hook.seconds).toBe(2.4);
  });

  it('rewrites a piece at a time', () => {
    const hook = foldHook(
      [render({ seconds: 2, content: (t) => ({ headline: t < 1 ? '14' : '27' }) })],
      false,
    );
    expect(hook.contentAt(CONTENT, 0)?.headline).toBe('14');
    expect(hook.contentAt(CONTENT, 1.5)?.headline).toBe('27');
    // Everything it did not speak about is untouched.
    expect(hook.contentAt(CONTENT, 0)?.caption).toBe('in Karijini');
  });

  it('hides a piece with null, and leaves one it omits alone', () => {
    const hook = foldHook([render({ content: () => ({ timing: null }) })], false);
    const out = hook.contentAt(CONTENT, 0);
    expect(out?.timing).toBeNull();
    expect(out?.kicker).toBe('Australia');
  });

  it('refuses to hide the headline — a badge without its numeral is not one', () => {
    const hook = foldHook([render({ content: () => ({ headline: null }) })], false);
    expect(hook.contentAt(CONTENT, 0)?.headline).toBe('27');
  });

  it('resolves a collision to the last layer that speaks', () => {
    const hook = foldHook(
      [
        render({ content: () => ({ caption: 'first' }) }),
        render({ content: () => ({ caption: 'last' }) }),
      ],
      false,
    );
    expect(hook.contentAt(CONTENT, 0)?.caption).toBe('last');
  });

  it('never invents content out of nothing', () => {
    const hook = foldHook([render({ content: () => ({ headline: '27' }) })], false);
    expect(hook.contentAt(null, 0)).toBeNull();
  });

  it('paints every layer in order, at the frame it is given', () => {
    const painted: string[] = [];
    const hook = foldHook(
      [
        render({ paint: (_g, t, frame) => painted.push(`a:${t}:${frame.width}`) }),
        render({ paint: () => painted.push('b') }),
      ],
      true,
    );
    hook.paint(null as unknown as CanvasRenderingContext2D, 0.5, {
      width: 1080,
      height: 1920,
    });
    expect(painted).toEqual(['a:0.5:1080', 'b']);
    expect(hook.ownsFrame).toBe(true);
  });

  it('merges the layers’ events into one bed, in time order', () => {
    const hook = foldHook(
      [
        render({ score: () => [{ at: 0.4, voice: 'tick' }] }),
        render({
          score: () => [
            { at: 0.1, voice: 'wood' },
            { at: 0.9, voice: 'seat' },
          ],
        }),
      ],
      false,
    );
    expect(hook.score().map((event) => event.at)).toEqual([0.1, 0.4, 0.9]);
  });
});
