import { describe, expect, it } from 'vitest';
import { menuAnchor, type MenuAnchorInput } from './menu-anchor';

const viewport = { width: 1280, height: 800 };
const menu = { width: 192, height: 140 };

/** A ⋯ button near the top-left of a gallery card. */
function input(over: Partial<MenuAnchorInput> = {}): MenuAnchorInput {
  return {
    trigger: { left: 300, right: 328, top: 200, bottom: 228 },
    menu,
    viewport,
    side: 'below',
    align: 'end',
    ...over,
  };
}

describe('menuAnchor', () => {
  it('opens below the trigger, its right edge on the trigger’s', () => {
    const a = menuAnchor(input());
    expect(a.placed).toBe('below');
    expect(a.top).toBe(234); // 228 + 6
    expect(a.left).toBe(328 - 192);
  });

  it('lines its LEFT edge up when asked to align at the start', () => {
    expect(menuAnchor(input({ align: 'start' })).left).toBe(300);
  });

  it('flips above when the bottom of the screen cannot hold it', () => {
    const a = menuAnchor(input({ trigger: { left: 300, right: 328, top: 700, bottom: 728 } }));
    expect(a.placed).toBe('above');
    expect(a.top).toBe(700 - 6 - 140);
  });

  it('flips below when the top cannot hold it', () => {
    const a = menuAnchor(input({ side: 'above', trigger: { left: 300, right: 328, top: 40, bottom: 68 } }));
    expect(a.placed).toBe('below');
    expect(a.top).toBe(74);
  });

  it('stays on the asked side when neither fits, and scrolls instead', () => {
    const a = menuAnchor(
      input({
        menu: { width: 192, height: 900 },
        trigger: { left: 300, right: 328, top: 380, bottom: 408 },
      }),
    );
    expect(a.placed).toBe('below');
    expect(a.maxHeight).toBe(800 - 8 - 408 - 6);
    expect(a.top).toBeGreaterThanOrEqual(8);
  });

  it('slides back in from the right edge rather than hanging off it', () => {
    const a = menuAnchor(input({ trigger: { left: 1250, right: 1276, top: 200, bottom: 228 } }));
    expect(a.left).toBe(1280 - 8 - 192);
  });

  it('slides back in from the left edge', () => {
    const a = menuAnchor(input({ trigger: { left: 4, right: 32, top: 200, bottom: 228 }, align: 'end' }));
    expect(a.left).toBe(8);
  });

  it('gives up the margin rather than the menu when it is wider than the screen', () => {
    const a = menuAnchor(input({ menu: { width: 400, height: 140 }, viewport: { width: 360, height: 800 } }));
    expect(a.left).toBe(8);
  });

  it('keeps a floor of room on a short viewport, never a negative height', () => {
    const a = menuAnchor(
      input({ viewport: { width: 360, height: 300 }, trigger: { left: 20, right: 48, top: 270, bottom: 296 } }),
    );
    expect(a.maxHeight).toBeGreaterThan(0);
    expect(a.top).toBeGreaterThanOrEqual(8);
    expect(a.top + Math.min(140, a.maxHeight)).toBeLessThanOrEqual(300 - 8 + 1);
  });
});
