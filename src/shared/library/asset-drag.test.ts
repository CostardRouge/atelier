import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_DRAG_TYPE,
  activeAssetDrag,
  beginAssetDrag,
  draggedAssetId,
  endAssetDrag,
  hasAssetDrag,
  startAssetDrag,
  subscribeAssetDrag,
  type AssetDragItem,
} from './asset-drag';

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

const item = (key: string): AssetDragItem => ({
  key,
  label: key,
  origin: 'library',
  resolve: async () => null,
});

afterEach(() => endAssetDrag());

describe('the transfer', () => {
  it('carries the key under our own type, with a plain-text twin', () => {
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

  it('refuses an empty key rather than handing back a blank', () => {
    expect(draggedAssetId(transfer({ [ASSET_DRAG_TYPE]: '   ' }))).toBeNull();
  });
});

describe('the drag in flight', () => {
  it('is readable while it lasts and gone once it ends', () => {
    const dt = transfer();
    expect(activeAssetDrag()).toBeNull();
    beginAssetDrag(dt, item('row:a'));
    expect(activeAssetDrag()?.key).toBe('row:a');
    expect(draggedAssetId(dt)).toBe('row:a');
    endAssetDrag();
    expect(activeAssetDrag()).toBeNull();
  });

  it('ends by itself when the page sees the drag is over, whatever became of its source', () => {
    vi.useFakeTimers();
    // Looked up at call time, so the page's timer is the faked one.
    const page = Object.assign(new EventTarget(), {
      setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
    });
    vi.stubGlobal('window', page);
    try {
      beginAssetDrag(transfer(), item('tile:gone'));
      page.dispatchEvent(new Event('pointermove'));
      expect(activeAssetDrag()).toBeNull();

      beginAssetDrag(transfer(), item('tile:dropped'));
      page.dispatchEvent(new Event('drop'));
      // Still readable by the target's own drop handler, which runs after.
      expect(activeAssetDrag()?.key).toBe('tile:dropped');
      vi.runAllTimers();
      expect(activeAssetDrag()).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('tells its subscribers when it starts and ends, and only then', () => {
    const seen = vi.fn();
    const off = subscribeAssetDrag(seen);
    beginAssetDrag(transfer(), item('row:a'));
    endAssetDrag();
    endAssetDrag(); // already over: nothing to say
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    beginAssetDrag(transfer(), item('row:b'));
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
