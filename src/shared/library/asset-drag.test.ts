import { describe, expect, it } from 'vitest';
import { ASSET_DRAG_TYPE, draggedAssetId, hasAssetDrag, startAssetDrag } from './asset-drag';

/** A DataTransfer as far as this module is concerned. */
function transfer(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, data: string) => void store.set(type, data),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
  };
}

describe('asset drag', () => {
  it('carries the id under our own type, with a plain-text twin', () => {
    const dt = transfer();
    startAssetDrag(dt, 'uluru-dusk');
    expect(dt.getData(ASSET_DRAG_TYPE)).toBe('uluru-dusk');
    expect(dt.getData('text/plain')).toBe('uluru-dusk');
    expect(dt.effectAllowed).toBe('copy');
    expect(hasAssetDrag(dt)).toBe(true);
    expect(draggedAssetId(dt)).toBe('uluru-dusk');
  });

  it('ignores a drag that is not ours — a file from the desktop, a selection', () => {
    const files = transfer({ Files: '' });
    expect(hasAssetDrag(files)).toBe(false);
    expect(draggedAssetId(files)).toBeNull();
    expect(hasAssetDrag(null)).toBe(false);
    expect(draggedAssetId(undefined)).toBeNull();
    expect(draggedAssetId(transfer({ 'text/plain': 'uluru-dusk' }))).toBeNull();
  });

  it('refuses an empty id rather than handing back a blank', () => {
    expect(draggedAssetId(transfer({ [ASSET_DRAG_TYPE]: '   ' }))).toBeNull();
  });
});
