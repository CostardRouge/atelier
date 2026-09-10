import { describe, expect, it } from 'vitest';
import { DOCK_SNAPS, dockFraction, dockHeightAt } from './DockedPanel';
import { dragFraction, nextSnap, snapAfterDrag } from './sheet-snap';

describe('the dock has two rests', () => {
  it('names them both ways round', () => {
    expect(dockFraction('strip')).toBe(DOCK_SNAPS[0]);
    expect(dockFraction('half')).toBe(DOCK_SNAPS[1]);
    expect(dockHeightAt(DOCK_SNAPS[0])).toBe('strip');
    expect(dockHeightAt(DOCK_SNAPS[1])).toBe('half');
  });

  it('rounds a loose fraction to the nearer rest', () => {
    const mid = (DOCK_SNAPS[0] + DOCK_SNAPS[1]) / 2;
    expect(dockHeightAt(mid - 0.01)).toBe('strip');
    expect(dockHeightAt(mid + 0.01)).toBe('half');
    // A drag that overshoots either way still lands on a real rest.
    expect(dockHeightAt(0.9)).toBe('half');
    expect(dockHeightAt(0.01)).toBe('strip');
  });

  it('leaves the stage the larger share at half', () => {
    // The whole point of the split: the piece stays bigger than the picker.
    expect(DOCK_SNAPS[1]).toBeLessThan(0.5);
  });
});

describe('the grip', () => {
  it('swaps the two rests on a tap', () => {
    expect(dockHeightAt(nextSnap(dockFraction('strip'), DOCK_SNAPS))).toBe('half');
    expect(dockHeightAt(nextSnap(dockFraction('half'), DOCK_SNAPS))).toBe('strip');
  });

  it('grows to half when dragged up from the strip', () => {
    // 300px up an 844px screen, from the strip.
    const f = dragFraction(dockFraction('strip'), -300, 844);
    expect(dockHeightAt(snapAfterDrag(f, DOCK_SNAPS) ?? 0)).toBe('half');
  });

  it('falls back to the strip when dragged down from half', () => {
    const f = dragFraction(dockFraction('half'), 250, 844);
    const landed = snapAfterDrag(f, DOCK_SNAPS);
    expect(landed).not.toBeNull();
    expect(dockHeightAt(landed ?? 0)).toBe('strip');
  });

  it('closes when dragged below the strip', () => {
    // Past the strip's own floor (0.8 × 0.13), which is what "gone" means.
    const f = dragFraction(dockFraction('strip'), 120, 844);
    expect(snapAfterDrag(f, DOCK_SNAPS)).toBeNull();
  });

  it('does not close on a small wobble at the strip', () => {
    const f = dragFraction(dockFraction('strip'), 12, 844);
    expect(snapAfterDrag(f, DOCK_SNAPS)).not.toBeNull();
  });
});
