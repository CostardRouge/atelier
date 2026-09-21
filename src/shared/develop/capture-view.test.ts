import { describe, expect, it } from 'vitest';
import { renditionsOf, type Rendition } from '../media/renditions';
import type { WinnowAssetRow } from '../sources/winnow/client';
import { rowCaptureInput, viewFacts, viewLabel, viewableRenditions, viewedRendition } from './capture-view';

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

const proxy: Rendition = {
  id: 'proxy',
  role: 'proxy',
  reach: 'file',
  name: 'DJI_0101.JPG',
  bytes: null,
  pixels: { width: 2048, height: 1152 },
  here: true,
  assetId: 'w/1',
  blocked: null,
};
const jpeg: Rendition = {
  id: 'delivered:dji_0101.jpg',
  role: 'delivered',
  reach: 'file',
  name: 'DJI_0101.JPG',
  bytes: 9_000_000,
  pixels: { width: 8064, height: 4536 },
  here: false,
  assetId: 'w/1',
  blocked: null,
};
const render: Rendition = {
  id: 'delivered:dji_0101.dng',
  role: 'delivered',
  reach: 'embedded',
  name: 'DJI_0101.DNG',
  bytes: 74_000_000,
  pixels: null,
  here: false,
  assetId: 'w/2',
  blocked: null,
};
const sensor: Rendition = { ...render, id: 'sensor:dji_0101.dng', role: 'sensor', reach: 'sensor' };

describe('what a viewer lists', () => {
  it('leaves the sensor out — a viewer draws files, Develop develops planes', () => {
    expect(viewableRenditions([proxy, jpeg, render, sensor]).map((r) => r.id)).toEqual([
      'proxy',
      'delivered:dji_0101.jpg',
      'delivered:dji_0101.dng',
    ]);
  });

  it('uses the fidelity chip’s own words', () => {
    expect(viewLabel(proxy)).toBe('Proxy');
    expect(viewLabel(jpeg)).toBe('DJI_0101.JPG');
    expect(viewLabel(render)).toBe('DJI_0101.DNG');
  });

  it('says what the file is, its pixels, its weight, and whether a click fetches', () => {
    expect(viewFacts(proxy, mb)).toBe('the proxy, where the picture opens · 2048 × 1152');
    expect(viewFacts(jpeg, mb)).toBe(
      'the file itself · 8064 × 4536 · 9 MB · fetched from its instance on request, held for this session',
    );
    expect(viewFacts({ ...render, here: true }, mb)).toBe('the render the camera wrote inside the RAW · 74 MB');
  });
});

describe('what the Develop verb carries', () => {
  const rows = [proxy, jpeg, render, sensor];

  it('is null for the opening row and for no choice at all, so a look writes no choice', () => {
    expect(viewedRendition(rows, null)).toBeNull();
    expect(viewedRendition(rows, 'proxy')).toBeNull();
  });

  it('is the rendition being viewed otherwise', () => {
    expect(viewedRendition(rows, 'delivered:dji_0101.jpg')).toBe('delivered:dji_0101.jpg');
    expect(viewedRendition(rows, 'delivered:dji_0101.dng')).toBe('delivered:dji_0101.dng');
  });

  it('never carries a blocked or unknown row', () => {
    expect(viewedRendition([proxy, { ...jpeg, blocked: 'this browser does not draw HIF' }], jpeg.id)).toBeNull();
    expect(viewedRendition(rows, 'delivered:nope.jpg')).toBeNull();
  });
});

describe('an instance’s row as a capture', () => {
  const row = {
    id: 1,
    filename: 'DJI_0101.JPG',
    width: 8064,
    height: 4536,
    file_size: 9_000_000,
    group_kind: 'raw_jpeg',
    companion_id: 2,
    companion_filename: 'DJI_0101.DNG',
    companion_file_size: 74_000_000,
    companion_media_type: 'photo',
    companion_width: 8064,
    companion_height: 4536,
  } as unknown as WinnowAssetRow;

  it('lists the proxy, the primary and the companion with the ids the workbench will use', () => {
    const rows = renditionsOf(rowCaptureInput(row, 'w', () => false));
    expect(rows.map((r) => [r.id, r.here])).toEqual([
      ['proxy', true],
      ['delivered:dji_0101.jpg', false],
      ['delivered:dji_0101.dng', false],
      ['sensor:dji_0101.dng', false],
    ]);
    expect(rows[1].pixels).toEqual({ width: 8064, height: 4536 });
    // The RAW's own pixels are the SENSOR's; its render is unmeasured until looked at.
    expect(rows[2].pixels).toBeNull();
    expect(rows[3].pixels).toEqual({ width: 8064, height: 4536 });
  });

  it('says which files the session already holds', () => {
    const rows = renditionsOf(rowCaptureInput(row, 'w', (id) => id === 'w/2'));
    expect(rows.find((r) => r.id === 'delivered:dji_0101.dng')?.here).toBe(true);
    expect(rows.find((r) => r.id === 'delivered:dji_0101.jpg')?.here).toBe(false);
  });

  it('refuses a Live Photo’s .mov as a file of the capture', () => {
    const live = { ...row, group_kind: 'live_photo', companion_filename: 'IMG_1.MOV', companion_media_type: 'video' } as unknown as WinnowAssetRow;
    expect(renditionsOf(rowCaptureInput(live, 'w', () => false)).map((r) => r.id)).toEqual(['proxy', 'delivered:dji_0101.jpg']);
  });
});
