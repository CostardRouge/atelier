import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import {
  clearDevelopClipboard,
  copyDevelop,
  hasCopiedDevelop,
  pasteDevelop,
  subscribeDevelopClipboard,
} from './develop-clipboard';

describe('the develop clipboard', () => {
  beforeEach(() => clearDevelopClipboard());

  it('holds nothing until something non-default is copied', () => {
    expect(hasCopiedDevelop()).toBe(false);
    expect(pasteDevelop()).toBeNull();
    copyDevelop({ ...DEFAULT_DEVELOP });
    expect(hasCopiedDevelop()).toBe(false);
    copyDevelop(null);
    expect(hasCopiedDevelop()).toBe(false);
  });

  it('pastes a copy, never the object it was given', () => {
    const src = { ...DEFAULT_DEVELOP, exposure: 0.7 };
    copyDevelop(src);
    src.exposure = 2;
    const pasted = pasteDevelop();
    expect(pasted?.exposure).toBe(0.7);
    pasted!.exposure = 3;
    expect(pasteDevelop()?.exposure).toBe(0.7);
  });

  it('tells its listeners on every copy and on a clear', () => {
    let ticks = 0;
    const off = subscribeDevelopClipboard(() => {
      ticks += 1;
    });
    copyDevelop({ ...DEFAULT_DEVELOP, tint: 5 });
    clearDevelopClipboard();
    off();
    copyDevelop({ ...DEFAULT_DEVELOP, tint: 6 });
    expect(ticks).toBe(2);
  });
});
