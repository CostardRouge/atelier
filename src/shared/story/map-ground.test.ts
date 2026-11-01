import { describe, expect, it } from 'vitest';
import { proj } from './geo';
import { groundBoxes, MAP_GROUND_DEFAULTS, readMapGround, unproj } from './map-ground';
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
