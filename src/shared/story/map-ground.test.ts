import { describe, expect, it } from 'vitest';
import { proj } from './geo';
import { groundBoxes, MAP_GROUND_DEFAULTS, readMapGround, seaBand, seaColour, unproj } from './map-ground';
import { withLook } from './sources';
import type { StoryScript } from './story-script';

describe('the map ground', () => {
  it('turns the projection back exactly', () => {
    const [x, y] = proj(151.21, -33.87);
    const [lon, lat] = unproj(x, y);
    expect(lon).toBeCloseTo(151.21, 9);
    expect(lat).toBeCloseTo(-33.87, 9);
  });

  it('keeps a well-formed choice field by field', () => {
    expect(readMapGround({ ground: 'tiles', tone: 'sepia', strength: 3 })).toEqual({ ground: 'tiles', tone: 'sepia', strength: 1 });
    expect(readMapGround({ ground: 'satellite', tone: 'pink' })).toBeUndefined();
    expect(readMapGround(null)).toBeUndefined();
  });

  it('asks a wide raster for the whole map and a finer one around the route', () => {
    const route = [proj(144.96, -37.81), proj(151.21, -33.87)];
    const [wide, near] = groundBoxes(route);
    expect(wide.box.west).toBeLessThan(113);
    expect(wide.box.east).toBeGreaterThan(155);
    expect(near.box.west).toBeLessThan(144.96);
    expect(near.box.east).toBeGreaterThan(151.21);
    expect(near.box.south).toBeLessThan(-37.81);
    expect(near.box.north).toBeGreaterThan(-33.87);
    // Finer: more pixels per degree than the wide one.
    expect(near.width / (near.box.east - near.box.west)).toBeGreaterThan(wide.width / (wide.box.east - wide.box.west));
    expect(Math.max(near.width, near.height)).toBeLessThanOrEqual(3072);
    expect(groundBoxes([])).toHaveLength(1);
  });

  it('keeps in the script only what differs from the outline', () => {
    const base = { kind: 'atelier.story-script', version: 1, posts: {} } as unknown as StoryScript;
    const tiles = withLook(base, { map: { ground: 'tiles', tone: 'night' } });
    expect(tiles.look?.map).toEqual({ ground: 'tiles', tone: 'night' });
    const back = withLook(tiles, { map: { ground: MAP_GROUND_DEFAULTS.ground, tone: MAP_GROUND_DEFAULTS.tone } });
    expect(back.look).toBeUndefined();
  });
});

describe('the sea beyond the tiles', () => {
  /** A raster of `w` × `h` filled with one colour, with a few odd pixels and a transparent row. */
  const raster = (w: number, h: number, rgb: [number, number, number]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) d.set([...rgb, 255], i * 4);
    return d;
  };

  it('reads the open sea’s colour, a label or an island not tinting it', () => {
    const d = raster(10, 4, [40, 60, 80]);
    d.set([255, 255, 255, 255], 0); // a label's white
    d.set([10, 10, 10, 255], 4 * 13); // an island's dark
    expect(seaColour(d, 10, 0, 4)).toBe('rgb(40,60,80)');
  });

  it('skips what the fade made transparent, and says nothing with nothing opaque', () => {
    const d = raster(4, 2, [1, 2, 3]);
    for (let i = 0; i < 8; i++) d[i * 4 + 3] = 0;
    expect(seaColour(d, 4, 0, 2)).toBeNull();
  });

  it('reads the band just above the wide raster’s fade', () => {
    const [from, to] = seaBand(1000, 0.16);
    expect(to).toBeCloseTo(840, 6);
    expect(from).toBeCloseTo(780, 6);
  });
});

