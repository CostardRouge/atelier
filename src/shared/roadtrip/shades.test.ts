import { describe, expect, it } from 'vitest';
import {
  MAX_CORE,
  MAX_SHADES,
  SHADE_DIRECTIONS,
  SHADE_FALLOFFS,
  SHADE_GRID,
  centreMovable,
  createShade,
  shadeCentre,
  shadeCore,
  shadeFalloff,
  directionInCell,
  followFlags,
  reachFollowsBadge,
  resolvedDirection,
  shadeCell,
  shadeFollow,
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

  it('is null when disabled, even at full strength', () => {
    expect(shadeGradient(shade({ enabled: false }))).toBeNull();
  });

  it('draws a shade stored before the switch existed (no enabled key)', () => {
    const stored = shade();
    delete stored.enabled;
    expect(shadeGradient(stored)).not.toBeNull();
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

  it('puts a corner radial ON its corner, a quarter circle of shade', () => {
    const corners = {
      'top-left': { cx: 0, cy: 0 },
      'top-right': { cx: 1, cy: 0 },
      'bottom-left': { cx: 0, cy: 1 },
      'bottom-right': { cx: 1, cy: 1 },
    } as const;
    for (const [direction, at] of Object.entries(corners)) {
      expect(
        shadeGradient(shade({ direction: direction as keyof typeof corners })),
      ).toMatchObject({ kind: 'radial', r0: 0, ...at });
    }
  });

  it('grows a corner with its reach, and draws nothing at none', () => {
    const near = shadeGradient(shade({ direction: 'bottom-left', reach: 0.3 })) as { r1: number };
    const far = shadeGradient(shade({ direction: 'bottom-left', reach: 0.8 })) as { r1: number };
    expect(far.r1).toBeGreaterThan(near.r1);
    expect(shadeGradient(shade({ direction: 'bottom-left', reach: 0 }))).toBeNull();
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

describe('shadeGradient — the fade has a shape (falloff, core, centre)', () => {
  /** The alpha a gradient draws at `at`, interpolated between its stops as a canvas does. */
  const alphaAt = (stops: { at: number; alpha: number }[], at: number) => {
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1];
      const b = stops[i];
      if (at <= b.at) return a.alpha + ((b.alpha - a.alpha) * (at - a.at)) / (b.at - a.at || 1);
    }
    return stops[stops.length - 1].alpha;
  };

  it('draws the very stops it always drew when none of the three is set', () => {
    // A stored shade must not move by a code value the day the fields ship.
    for (const d of SHADE_DIRECTIONS) {
      for (const invert of [false, true]) {
        const legacy = shadeGradient(shade({ direction: d.id, invert, reach: 0.5 }))!;
        const soft = shadeGradient(
          shade({ direction: d.id, invert, reach: 0.5, falloff: 'soft', core: 0 }),
        )!;
        expect(soft).toEqual(legacy);
        expect(legacy.stops.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('reads garbage as absent', () => {
    const legacy = shadeGradient(shade())!;
    const junk = shadeGradient(
      shade({ falloff: 'bouncy' as never, core: Number.NaN, center: { x: Number.NaN, y: 4 } }),
    )!;
    expect(junk.stops).toEqual(legacy.stops);
    expect(shadeFalloff({ falloff: 'bouncy' as never })).toBe('soft');
    expect(shadeCore({ core: -1 })).toBe(0);
    expect(shadeCore({ core: 5 })).toBe(MAX_CORE);
    expect(shadeCentre({})).toEqual({ x: 0.5, y: 0.5 });
  });

  it('holds full strength across the core — a ZONE, not a line', () => {
    // The maintainer's report: 100 % strength and 100 % reach on a middle band
    // was a dark stroke inside a gradient.
    const before = shadeGradient(shade({ direction: 'middle-vertical', reach: 1, strength: 1 }))!;
    const after = shadeGradient(
      shade({ direction: 'middle-vertical', reach: 1, strength: 1, core: 0.5 }),
    )!;
    // A quarter of the frame from the centre line: a third before, full now.
    expect(alphaAt(before.stops, 0.75)).toBeLessThan(0.5);
    expect(alphaAt(after.stops, 0.75)).toBeCloseTo(1, 6);
    expect(alphaAt(after.stops, 0.25)).toBeCloseTo(1, 6);
    // And it still clears at both ends.
    expect(after.stops[0].alpha).toBe(0);
    expect(after.stops[after.stops.length - 1].alpha).toBe(0);
  });

  it('holds the core at the FAR end when inverted', () => {
    const g = shadeGradient(shade({ direction: 'top', reach: 1, strength: 0.8, invert: true, core: 0.4 }))!;
    expect(g.stops[0].alpha).toBe(0);
    expect(alphaAt(g.stops, 0.7)).toBeCloseTo(0.8, 6);
    expect(alphaAt(g.stops, 1)).toBeCloseTo(0.8, 6);
  });

  it('gives every falloff its own curve, all starting at strength and ending clear', () => {
    const seen = new Set<string>();
    for (const f of SHADE_FALLOFFS) {
      const g = shadeGradient(shade({ direction: 'bottom', strength: 0.9, falloff: f.id, core: 0.1 }))!;
      expect(g.stops[0].alpha).toBeCloseTo(0.9, 6);
      expect(g.stops[g.stops.length - 1].alpha).toBeCloseTo(0, 6);
      seen.add(JSON.stringify(g.stops.map((s) => s.alpha.toFixed(4))));
    }
    expect(seen.size).toBe(SHADE_FALLOFFS.length);
  });

  it('holds longer on Held than on Quick', () => {
    const held = shadeGradient(shade({ direction: 'left', strength: 1, falloff: 'in-cubic' }))!;
    const quick = shadeGradient(shade({ direction: 'left', strength: 1, falloff: 'out-cubic' }))!;
    expect(alphaAt(held.stops, 0.5)).toBeGreaterThan(0.8);
    expect(alphaAt(quick.stops, 0.5)).toBeLessThan(0.2);
  });

  it('keeps sampled stops in order, from 0 to 1, within the strength', () => {
    for (const d of SHADE_DIRECTIONS) {
      for (const invert of [false, true]) {
        for (const core of [0, 0.3, MAX_CORE]) {
          for (const f of SHADE_FALLOFFS) {
            const g = shadeGradient(
              shade({ direction: d.id, invert, core, falloff: f.id, strength: 0.6, reach: 0.7 }),
            )!;
            expect(g.stops[0].at).toBe(0);
            expect(g.stops[g.stops.length - 1].at).toBe(1);
            for (let i = 1; i < g.stops.length; i++) {
              expect(g.stops[i].at).toBeGreaterThan(g.stops[i - 1].at);
            }
            for (const s of g.stops) {
              expect(s.alpha).toBeGreaterThanOrEqual(0);
              expect(s.alpha).toBeLessThanOrEqual(0.6 + 1e-9);
            }
          }
        }
      }
    }
  });

  it('keeps a sampled band peaking exactly on its centre', () => {
    const g = shadeGradient(shade({ direction: 'middle-horizontal', strength: 0.7, falloff: 'in-out' }))!;
    expect(g.stops.find((s) => s.at === 0.5)!.alpha).toBeCloseTo(0.7, 6);
  });

  it('moves a band along its own axis only, the peak on the centre it was given', () => {
    const v = shadeGradient(
      shade({ direction: 'middle-vertical', reach: 0.6, center: { x: 0.9, y: 0.3 } }),
    ) as LinearShade;
    expect(v.x0).toBe(0);
    expect((v.y0 + v.y1) / 2).toBeCloseTo(0.3, 9);
    expect(v.y1 - v.y0).toBeCloseTo(0.6, 9);
    const h = shadeGradient(
      shade({ direction: 'middle-horizontal', reach: 0.6, center: { x: 0.2, y: 0.9 } }),
    ) as LinearShade;
    expect((h.x0 + h.x1) / 2).toBeCloseTo(0.2, 9);
    // Past the frame's edge rather than clamped, or the peak would slide.
    expect(h.x0).toBeLessThan(0);
  });

  it('moves a free radial anywhere, and hands it to the badge when following', () => {
    const free = shadeGradient(shade({ direction: 'radial', center: { x: 0.3, y: 0.7 } }));
    expect(free).toMatchObject({ kind: 'radial', cx: 0.3, cy: 0.7 });
    const hooked = shadeGradient(
      shade({ direction: 'radial', followHook: true, center: { x: 0.3, y: 0.1 } }),
      block,
    );
    expect(hooked).toMatchObject({ cx: 0.5, cy: (block.top + block.bottom) / 2 });
  });

  it('leaves an edge and a corner where they are, whatever the centre says', () => {
    for (const direction of ['top', 'left', 'bottom-right'] as const) {
      expect(shadeGradient(shade({ direction, center: { x: 0.1, y: 0.1 } }))).toEqual(
        shadeGradient(shade({ direction })),
      );
    }
  });

  it('says which axis of the centre the author can move', () => {
    expect(centreMovable('middle-vertical', 'edge')).toBe('y');
    expect(centreMovable('middle-horizontal', 'none')).toBe('x');
    expect(centreMovable('radial', 'none')).toBe('both');
    expect(centreMovable('radial', 'edge')).toBeNull();
    expect(centreMovable('top', 'none')).toBeNull();
    expect(centreMovable('bottom-left', 'none')).toBeNull();
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

describe('the direction grid', () => {
  it('holds every direction exactly once', () => {
    const all = SHADE_GRID.flatMap((c) => c.shapes);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(SHADE_DIRECTIONS.map((d) => d.id).sort());
  });

  it('files a direction under its cell, the bands under the centre', () => {
    expect(shadeCell('top')).toBe('top-center');
    expect(shadeCell('left')).toBe('center-left');
    expect(shadeCell('bottom-right')).toBe('bottom-right');
    expect(shadeCell('middle-vertical')).toBe('center');
    expect(shadeCell('radial')).toBe('center');
  });

  it("keeps a shape that already lives in the cell, else takes the cell's first", () => {
    expect(directionInCell('center', 'middle-horizontal')).toBe('middle-horizontal');
    expect(directionInCell('center', 'bottom')).toBe('radial');
    expect(directionInCell('bottom-left', 'radial')).toBe('bottom-left');
  });
});

describe('shadeGradient — following the anchor', () => {
  const at = (anchor: (typeof SHADE_GRID)[number]['cell']) => ({ ...block, anchor });

  it("reads the follow mode from the two flags, absent followAnchor as off", () => {
    const stored = shade({ followHook: true });
    delete stored.followAnchor;
    expect(shadeFollow(stored)).toBe('edge');
    for (const follow of ['none', 'edge', 'anchor'] as const) {
      expect(shadeFollow(shade(followFlags(follow)))).toBe(follow);
    }
  });

  it("takes the badge's cell, keeping its own direction underneath", () => {
    const s = shade({ direction: 'top', ...followFlags('anchor') });
    expect(resolvedDirection(s, at('bottom-left'))).toBe('bottom-left');
    expect(resolvedDirection(s, at('center-right'))).toBe('right');
    expect(s.direction).toBe('top');
    expect(shadeGradient(s, at('bottom-left'))).toMatchObject({ kind: 'radial', cx: 0, cy: 1 });
  });

  it('keeps its own direction with no anchor to follow, or when not asked', () => {
    expect(resolvedDirection(shade({ direction: 'top', ...followFlags('anchor') }), block)).toBe('top');
    expect(resolvedDirection(shade({ direction: 'top', ...followFlags('anchor') }), null)).toBe('top');
    expect(resolvedDirection(shade({ direction: 'top', followHook: true }), at('bottom-left'))).toBe('top');
  });

  it("lands on the block's edge as well, like following the edge", () => {
    const anchored = shadeGradient(shade({ ...followFlags('anchor') }), at('bottom-center'));
    const edged = shadeGradient(shade({ direction: 'bottom', ...followFlags('edge') }), block);
    expect(anchored).toEqual(edged);
  });

  it('says when the badge, not the slider, sets the reach', () => {
    expect(reachFollowsBadge('bottom', 'anchor')).toBe(true);
    expect(reachFollowsBadge('top', 'edge')).toBe(true);
    expect(reachFollowsBadge('bottom', 'none')).toBe(false);
    expect(reachFollowsBadge('bottom-left', 'anchor')).toBe(false);
    expect(reachFollowsBadge('left', 'edge')).toBe(false);
  });
});
