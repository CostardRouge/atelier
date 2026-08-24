import { describe, expect, it } from 'vitest';
import {
  MAX_SHADES,
  SHADE_DIRECTIONS,
  createShade,
  shadeGradient,
  vignetteShade,
  type LinearShade,
  type Shade,
} from './shades';

const shade = (over: Partial<Shade> = {}): Shade => ({
  ...createShade(),
  id: 'fixed',
  ...over,
});

const block = { top: 0.62, bottom: 0.88 };

describe('shadeGradient — nothing to draw', () => {
  it('is null with no strength', () => {
    expect(shadeGradient(shade({ strength: 0 }))).toBeNull();
  });

  it('is null with no reach', () => {
    expect(shadeGradient(shade({ reach: 0 }))).toBeNull();
    expect(shadeGradient(shade({ direction: 'radial', reach: 0 }))).toBeNull();
  });

  it('draws nothing rather than something transparent', () => {
    // A zero-alpha fill still costs a composite on every exported frame.
    for (const direction of SHADE_DIRECTIONS) {
      expect(shadeGradient(shade({ direction: direction.id, strength: 0 }))).toBeNull();
    }
  });
});

describe('shadeGradient — every direction is a different gradient', () => {
  it('anchors an edge shade at its own edge', () => {
    expect(shadeGradient(shade({ direction: 'top', reach: 0.5 }))).toMatchObject({
      kind: 'linear',
      y0: 0,
      y1: 0.5,
    });
    expect(shadeGradient(shade({ direction: 'bottom', reach: 0.5 }))).toMatchObject({
      y0: 1,
      y1: 0.5,
    });
    expect(shadeGradient(shade({ direction: 'left', reach: 0.4 }))).toMatchObject({
      x0: 0,
      x1: 0.4,
    });
    expect(shadeGradient(shade({ direction: 'right', reach: 0.4 }))).toMatchObject({
      x0: 1,
      x1: 0.6,
    });
  });

  it('runs a middle band edge to edge, symmetric about the centre', () => {
    // Measured in a browser: drawn centre→edge, a canvas gradient holds its
    // end colour past the endpoint and blacks out the whole far half.
    expect(shadeGradient(shade({ direction: 'middle-vertical', reach: 0.6 }))).toMatchObject({
      y0: 0.2,
      y1: 0.8,
    });
    expect(
      shadeGradient(shade({ direction: 'middle-horizontal', reach: 0.6 })),
    ).toMatchObject({ x0: 0.2, x1: 0.8 });
  });

  it('peaks in the middle of a band and clears at BOTH ends', () => {
    for (const direction of ['middle-vertical', 'middle-horizontal'] as const) {
      const g = shadeGradient(shade({ direction, strength: 0.8 }))!;
      const first = g.stops[0];
      const last = g.stops[g.stops.length - 1];
      const middle = g.stops.find((st) => st.at === 0.5)!;
      expect(first.alpha).toBe(0);
      expect(last.alpha).toBe(0);
      expect(middle.alpha).toBeCloseTo(0.8, 6);
    }
  });

  it('inverts a band into a clear middle with dark at both ends', () => {
    // The case the maintainer asked for by name: a portrait frame whose text
    // sits in the middle, lifted by darkening away from it.
    const g = shadeGradient(
      shade({ direction: 'middle-vertical', strength: 0.8, invert: true }),
    )!;
    expect(g.stops[0].alpha).toBeCloseTo(0.8, 6);
    expect(g.stops[g.stops.length - 1].alpha).toBeCloseTo(0.8, 6);
    expect(g.stops.find((st) => st.at === 0.5)!.alpha).toBe(0);
  });

  it('centres a radial on the frame', () => {
    expect(shadeGradient(shade({ direction: 'radial' }))).toMatchObject({
      kind: 'radial',
      cx: 0.5,
      cy: 0.5,
      r0: 0,
    });
  });

  it('gives each direction its own geometry — none is a duplicate', () => {
    const seen = SHADE_DIRECTIONS.map((d) =>
      JSON.stringify(shadeGradient(shade({ direction: d.id, reach: 0.5 }))),
    );
    expect(new Set(seen).size).toBe(SHADE_DIRECTIONS.length);
  });
});

describe('shadeGradient — inversion', () => {
  it('puts the dark end at the far end of the reach', () => {
    // "Top, reaching halfway, inverted" is clear at the top edge and dark at
    // mid-frame — the band no un-inverted shade can draw.
    const plain = shadeGradient(shade({ direction: 'top', reach: 0.5 }))!;
    const inverted = shadeGradient(shade({ direction: 'top', reach: 0.5, invert: true }))!;
    expect(plain.stops[0].alpha).toBeGreaterThan(0);
    expect(plain.stops[plain.stops.length - 1].alpha).toBe(0);
    expect(inverted.stops[0].alpha).toBe(0);
    expect(inverted.stops[inverted.stops.length - 1].alpha).toBeGreaterThan(0);
  });

  it('keeps the stops in order, so a canvas accepts them', () => {
    for (const invert of [false, true]) {
      for (const d of SHADE_DIRECTIONS) {
        const g = shadeGradient(shade({ direction: d.id, invert, reach: 0.5 }))!;
        for (let i = 1; i < g.stops.length; i++) {
          expect(g.stops[i].at).toBeGreaterThan(g.stops[i - 1].at);
        }
        expect(g.stops[0].at).toBe(0);
        expect(g.stops[g.stops.length - 1].at).toBe(1);
      }
    }
  });

  it('never exceeds the asked-for strength', () => {
    for (const invert of [false, true]) {
      const g = shadeGradient(shade({ strength: 0.4, invert }))!;
      for (const stop of g.stops) expect(stop.alpha).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it('eases the middle, so the fade does not read as a hard edge', () => {
    const g = shadeGradient(shade({ strength: 1 }))!;
    const middle = g.stops.find((s) => s.at > 0 && s.at < 1)!;
    expect(middle.alpha).toBeGreaterThan(0);
    expect(middle.alpha).toBeLessThan(1);
  });
});

describe('shadeGradient — following the hook', () => {
  it('lands a bottom shade on the block instead of the reach', () => {
    const free = shadeGradient(shade({ direction: 'bottom', reach: 0.5 })) as LinearShade;
    const hooked = shadeGradient(
      shade({ direction: 'bottom', reach: 0.5, followHook: true }),
      block,
    ) as LinearShade;
    expect(hooked.y1).not.toBeCloseTo(free.y1, 6);
    // It clears the first line of the badge rather than cutting across it.
    expect(hooked.y1).toBeLessThan(block.top);
  });

  it('moves with the badge', () => {
    const low = shadeGradient(shade({ direction: 'bottom', followHook: true }), {
      top: 0.7,
      bottom: 0.95,
    }) as LinearShade;
    const high = shadeGradient(shade({ direction: 'bottom', followHook: true }), {
      top: 0.3,
      bottom: 0.55,
    }) as LinearShade;
    expect(high.y1).toBeLessThan(low.y1);
  });

  it('centres a radial on the badge', () => {
    const g = shadeGradient(
      shade({ direction: 'radial', followHook: true }),
      block,
    ) as { cy: number };
    expect(g.cy).toBeCloseTo((block.top + block.bottom) / 2, 6);
  });

  it('falls back to its own reach when there is no block', () => {
    const g = shadeGradient(
      shade({ direction: 'bottom', reach: 0.5, followHook: true }),
      null,
    ) as LinearShade;
    expect(g.y1).toBeCloseTo(0.5, 6);
  });
});

describe('shadeGradient — bounds', () => {
  it('keeps every point inside the frame, whatever it is handed', () => {
    for (const d of SHADE_DIRECTIONS) {
      for (const reach of [-1, 0.5, 4, Number.NaN]) {
        const g = shadeGradient(shade({ direction: d.id, reach }));
        if (!g) continue;
        const points = g.kind === 'linear' ? [g.x0, g.y0, g.x1, g.y1] : [g.cx, g.cy];
        for (const p of points) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('vignetteShade', () => {
  it('is a radial, inverted — dark at the corners, clear in the middle', () => {
    const v = vignetteShade(0.5);
    expect(v.direction).toBe('radial');
    expect(v.invert).toBe(true);
    const g = shadeGradient(v)!;
    expect(g.stops[0].alpha).toBe(0);
  });

  it('takes a colour, because black is a choice and not a law', () => {
    expect(vignetteShade(0.5, '#1b1813').color).toBe('#1b1813');
  });
});

describe('createShade', () => {
  it('gives every shade its own id', () => {
    expect(createShade().id).not.toBe(createShade().id);
  });

  it('leaves room for a handful, not a paint job', () => {
    expect(MAX_SHADES).toBeGreaterThan(1);
    expect(MAX_SHADES).toBeLessThan(9);
  });
});
