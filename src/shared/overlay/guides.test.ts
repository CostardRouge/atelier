import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GUIDES,
  clampDivisions,
  findSafeZone,
  orientationOf,
  resolveSafeZone,
  rotateSafeZone,
  shouldRotateSafeZone,
  snap,
  snapToGrid,
  targetFrame,
  type GuidesState,
  type SafeZonePreset,
} from './guides';

describe('snap', () => {
  it('pulls a coordinate onto an edge or the centre when it is close', () => {
    expect(snap(0.01)).toBe(0);
    expect(snap(0.99)).toBe(1);
    expect(snap(0.51)).toBe(0.5);
  });

  it('leaves a coordinate alone elsewhere', () => {
    expect(snap(0.3)).toBe(0.3);
    expect(snap(0.47)).toBe(0.47);
  });

  it('takes its tolerance from the caller', () => {
    expect(snap(0.05, 0.1)).toBe(0);
    expect(snap(0.05, 0.02)).toBe(0.05);
  });
});

describe('snapToGrid', () => {
  it('snaps to the nearest division within tolerance', () => {
    expect(snapToGrid(0.34, 3)).toBeCloseTo(1 / 3);
    expect(snapToGrid(0.0, 3)).toBe(0);
    expect(snapToGrid(1.0, 3)).toBe(1);
  });

  it('leaves values that are not close to any line', () => {
    // Thirds are 0, .333, .667, 1 — 0.5 is far from all of them.
    expect(snapToGrid(0.5, 3)).toBe(0.5);
  });

  it('treats a single division as edges only', () => {
    expect(snapToGrid(0.02, 1)).toBe(0);
    expect(snapToGrid(0.99, 1)).toBe(1);
    expect(snapToGrid(0.4, 1)).toBe(0.4);
  });

  it('returns the input when divisions < 1', () => {
    expect(snapToGrid(0.42, 0)).toBe(0.42);
  });
});

describe('clampDivisions', () => {
  it('rounds and clamps to [1, 12]', () => {
    expect(clampDivisions(0)).toBe(1);
    expect(clampDivisions(3.4)).toBe(3);
    expect(clampDivisions(99)).toBe(12);
    expect(clampDivisions(NaN)).toBe(1);
  });
});

describe('targetFrame', () => {
  it('pillarboxes a vertical target inside a landscape frame', () => {
    const f = targetFrame(9 / 16, 1920, 1080);
    expect(f.h).toBe(1080);
    expect(f.w).toBeCloseTo(1080 * (9 / 16)); // 607.5
    expect(f.x).toBeCloseTo((1920 - 607.5) / 2);
    expect(f.y).toBe(0);
  });

  it('letterboxes a wider target inside a square-ish frame', () => {
    const f = targetFrame(16 / 9, 1000, 1000);
    expect(f.w).toBe(1000);
    expect(f.h).toBeCloseTo(1000 / (16 / 9)); // 562.5
    expect(f.x).toBe(0);
    expect(f.y).toBeCloseTo((1000 - 562.5) / 2);
  });

  it('fills exactly when the aspect matches the frame', () => {
    const f = targetFrame(16 / 9, 1920, 1080);
    expect(f.w).toBeCloseTo(1920);
    expect(f.h).toBeCloseTo(1080);
    expect(f.x).toBeCloseTo(0);
    expect(f.y).toBeCloseTo(0);
  });
});

describe('orientationOf', () => {
  it('sorts portrait, landscape and square-ish aspects', () => {
    expect(orientationOf(9 / 16)).toBe(-1);
    expect(orientationOf(16 / 9)).toBe(1);
    expect(orientationOf(1)).toBe(0);
    expect(orientationOf(4 / 5)).toBe(-1);
  });

  it('treats a missing or nonsense aspect as square (never rotates)', () => {
    expect(orientationOf(0)).toBe(0);
    expect(orientationOf(NaN)).toBe(0);
    expect(orientationOf(-2)).toBe(0);
  });
});

describe('shouldRotateSafeZone', () => {
  it('auto turns a portrait template over a landscape frame, and back', () => {
    expect(shouldRotateSafeZone('auto', 9 / 16, 16 / 9)).toBe(true);
    expect(shouldRotateSafeZone('auto', 16 / 9, 9 / 16)).toBe(true);
  });

  it('auto leaves a template whose orientation already matches', () => {
    expect(shouldRotateSafeZone('auto', 9 / 16, 9 / 16)).toBe(false);
    expect(shouldRotateSafeZone('auto', 16 / 9, 16 / 9)).toBe(false);
  });

  it('auto stands down on a square frame or a square template', () => {
    expect(shouldRotateSafeZone('auto', 9 / 16, 1)).toBe(false);
    expect(shouldRotateSafeZone('auto', 1, 16 / 9)).toBe(false);
  });

  it('the manual modes win over the frame', () => {
    expect(shouldRotateSafeZone('upright', 9 / 16, 16 / 9)).toBe(false);
    expect(shouldRotateSafeZone('rotated', 9 / 16, 9 / 16)).toBe(true);
  });
});

describe('rotateSafeZone', () => {
  const preset: SafeZonePreset = {
    id: 'test',
    label: 'Test',
    aspect: 9 / 16,
    deadzones: [
      { x: 0, y: 0, w: 1, h: 0.08, label: 'Top' },
      { x: 0.84, y: 0.38, w: 0.16, h: 0.44, label: 'Actions' },
    ],
  };

  it('inverts the aspect', () => {
    expect(rotateSafeZone(preset).aspect).toBeCloseTo(16 / 9);
  });

  it('carries the top bar onto the right edge (a clockwise quarter-turn)', () => {
    const [top] = rotateSafeZone(preset).deadzones;
    expect(top.x).toBeCloseTo(0.92);
    expect(top.y).toBeCloseTo(0);
    expect(top.w).toBeCloseTo(0.08);
    expect(top.h).toBeCloseTo(1);
  });

  it('carries the right-hand action column onto the bottom', () => {
    const [, actions] = rotateSafeZone(preset).deadzones;
    expect(actions.x).toBeCloseTo(0.18);
    expect(actions.y).toBeCloseTo(0.84);
    expect(actions.w).toBeCloseTo(0.44);
    expect(actions.h).toBeCloseTo(0.16);
  });

  it('keeps every zone inside the frame and its labels intact', () => {
    for (const r of rotateSafeZone(preset).deadzones) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
    }
    expect(rotateSafeZone(preset).deadzones[0].label).toBe('Top');
  });

  it('turned four times, it is back where it started', () => {
    const back = rotateSafeZone(
      rotateSafeZone(rotateSafeZone(rotateSafeZone(preset))),
    );
    expect(back.aspect).toBeCloseTo(preset.aspect);
    back.deadzones.forEach((r, i) => {
      expect(r.x).toBeCloseTo(preset.deadzones[i].x);
      expect(r.y).toBeCloseTo(preset.deadzones[i].y);
      expect(r.w).toBeCloseTo(preset.deadzones[i].w);
      expect(r.h).toBeCloseTo(preset.deadzones[i].h);
    });
  });
});

describe('resolveSafeZone', () => {
  const guides = (patch: Partial<GuidesState>): GuidesState => ({
    ...DEFAULT_GUIDES,
    ...patch,
  });

  it('is null with no preset picked', () => {
    expect(resolveSafeZone(guides({ safeZone: 'none' }), 16 / 9)).toBeNull();
    expect(resolveSafeZone(guides({ safeZone: 'nope' }), 16 / 9)).toBeNull();
  });

  it('spans a landscape frame instead of banding across its middle', () => {
    const reels = findSafeZone('reels')!;
    const resolved = resolveSafeZone(guides({ safeZone: 'reels' }), 16 / 9)!;
    expect(resolved.aspect).toBeCloseTo(16 / 9);
    // With the template's aspect now the frame's, the target frame IS the frame.
    const f = targetFrame(resolved.aspect, 1920, 1080);
    expect(f.w).toBeCloseTo(1920);
    expect(f.h).toBeCloseTo(1080);
    // The upright template would have been pillarboxed to a middle band.
    expect(targetFrame(reels.aspect, 1920, 1080).w).toBeLessThan(700);
  });

  it('leaves the template alone over a matching frame', () => {
    const resolved = resolveSafeZone(guides({ safeZone: 'reels' }), 9 / 16)!;
    expect(resolved).toEqual(findSafeZone('reels'));
  });

  it("'upright' gets the authored template back over a landscape frame", () => {
    const resolved = resolveSafeZone(
      guides({ safeZone: 'reels', safeZoneOrientation: 'upright' }),
      16 / 9,
    )!;
    expect(resolved).toEqual(findSafeZone('reels'));
  });

  it('defaults to auto for a state written before the field existed', () => {
    const legacy = { safeZone: 'reels', grid: DEFAULT_GUIDES.grid } as GuidesState;
    expect(resolveSafeZone(legacy, 16 / 9)!.aspect).toBeCloseTo(16 / 9);
  });
});
