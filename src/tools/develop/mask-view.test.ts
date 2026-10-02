import { describe, expect, it } from 'vitest';
import { MASK_VIEW_LABELS, nextMaskView, shownMaskView } from './mask-view';

describe('the mask view', () => {
  it('steps hidden → outline → fill → hidden, on M and on the bar', () => {
    expect(nextMaskView('off')).toBe('outline');
    expect(nextMaskView('outline')).toBe('fill');
    expect(nextMaskView('fill')).toBe('off');
    expect(Object.values(MASK_VIEW_LABELS)).toEqual(['Hidden', 'Outline', 'Fill']);
  });

  it('shows the outline by itself while the pointer makes the mask, and keeps a chosen view either way', () => {
    expect(shownMaskView('off', true)).toBe('outline');
    expect(shownMaskView('off', false)).toBe('off');
    expect(shownMaskView('fill', true)).toBe('fill');
    expect(shownMaskView('outline', false)).toBe('outline');
  });
});
