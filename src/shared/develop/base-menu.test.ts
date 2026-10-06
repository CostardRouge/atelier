import { describe, expect, it } from 'vitest';
import type { Rendition } from '../media/renditions';
import { fullPixels, groupRenditions, megapixelsLabel, rowFigures, shortOf } from './base-menu';

function row(id: string, role: Rendition['role'], name: string, width?: number, height?: number): Rendition {
  return {
    id,
    role,
    reach: role === 'sensor' ? 'sensor' : 'file',
    name,
    bytes: null,
    pixels: width && height ? { width, height } : null,
    here: true,
    assetId: null,
    blocked: null,
  };
}

// A DJI capture as Winnow serves it: a proxy, the render inside the DNG, the
// JPEG beside it, and the sensor.
const DJI = [
  row('proxy', 'proxy', '', 2048, 1152),
  row('delivered:dji_0202.dng', 'delivered', 'DJI_0202.DNG', 960, 540),
  row('delivered:dji_0202.jpg', 'delivered', 'DJI_0202.JPG', 8064, 4536),
  row('sensor:dji_0202.dng', 'sensor', 'DJI_0202.DNG', 8064, 4536),
];

describe('groupRenditions', () => {
  it('groups by role, proxy first, keeping the order inside a group', () => {
    const groups = groupRenditions([DJI[3], DJI[1], DJI[0], DJI[2]]);
    expect(groups.map((g) => g.role)).toEqual(['proxy', 'delivered', 'sensor']);
    expect(groups[1].rows.map((r) => r.name)).toEqual(['DJI_0202.DNG', 'DJI_0202.JPG']);
  });

  it('leaves an empty group out', () => {
    expect(groupRenditions([DJI[2]]).map((g) => g.role)).toEqual(['delivered']);
  });
});

describe('the figures', () => {
  it('says megapixels with one decimal, and nothing for an unmeasured row', () => {
    expect(megapixelsLabel({ width: 8064, height: 4536 })).toBe('36.6 MP');
    expect(megapixelsLabel({ width: 960, height: 540 })).toBe('0.5 MP');
    expect(megapixelsLabel(null)).toBeNull();
  });

  it('counts the shortfall against the capture’s biggest picture, from 1.5× on', () => {
    const full = fullPixels(DJI);
    expect(full).toEqual({ width: 8064, height: 4536 });
    expect(shortOf({ width: 960, height: 540 }, full)).toBe('8.4× short');
    expect(shortOf({ width: 2048, height: 1152 }, full)).toBe('3.9× short');
    expect(shortOf({ width: 7008, height: 4672 }, { width: 7040, height: 4688 })).toBeNull();
    expect(shortOf(null, full)).toBeNull();
  });

  it('gives a row its size, depth and shortfall, and the sensor none of the last', () => {
    const full = fullPixels(DJI);
    expect(rowFigures(DJI[1], full)).toEqual({ megapixels: '0.5 MP', size: '960 × 540', depth: '8-bit', short: '8.4× short' });
    expect(rowFigures(DJI[3], full)).toEqual({ megapixels: '36.6 MP', size: '8064 × 4536', depth: '16-bit linear', short: null });
  });

  it('claims no bit depth for a clip', () => {
    const rush = row('delivered:dji_0211.mp4', 'delivered', 'DJI_0211.MP4', 3840, 2160);
    expect(rowFigures(rush, rush.pixels).depth).toBeNull();
  });
});
