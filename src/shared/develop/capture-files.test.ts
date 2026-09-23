import { describe, expect, it } from 'vitest';
import { renditionsOf } from '../media/renditions';
import type { MediaOrigin } from '../projects/media-identity';
import { captureInput } from './capture-files';

function file(name: string, bytes = 1000): File {
  return new File([new Uint8Array(bytes)], name);
}

const proxyOver = (name: string, width: number, height: number, bytes: number): MediaOrigin => ({
  sourceId: 'winnow.example',
  fidelity: 'proxy',
  width,
  height,
  name,
  bytes,
  fetchOriginal: () => Promise.reject(new Error('not in a test')),
});

describe('captureInput', () => {
  it('lists a local ARW as its own render and its sensor, and nothing else', () => {
    const rows = renditionsOf(
      captureInput({
        file: file('DSC08463.ARW', 34.6e6),
        origin: null,
        measured: { width: 7008, height: 4672, viaRawPreview: true },
        sensor: { width: 7040, height: 4688 },
      }),
    );
    expect(rows.map((r) => [r.id, r.here])).toEqual([
      ['delivered:dsc08463.arw', true],
      ['sensor:dsc08463.arw', true],
    ]);
    expect(rows[0].pixels).toEqual({ width: 7008, height: 4672 });
    expect(rows[1].pixels).toEqual({ width: 7040, height: 4688 });
  });

  it('puts a proxy first and its drawable original after it, with the source’s pixels and weight', () => {
    const rows = renditionsOf(
      captureInput({
        file: file('DJI_0101.webp', 4e5),
        origin: proxyOver('DJI_0101.JPG', 8064, 4536, 9e6),
        measured: { width: 2048, height: 1152 },
        sensor: null,
        original: { assetId: 'winnow.example/12', held: false },
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(['proxy', 'delivered:dji_0101.jpg']);
    expect(rows[1]).toMatchObject({
      reach: 'file',
      here: false,
      assetId: 'winnow.example/12',
      bytes: 9e6,
      pixels: { width: 8064, height: 4536 },
    });
    expect(rows[0].pixels).toEqual({ width: 2048, height: 1152 });
  });

  it('says a proxy’s RAW original is in hand once it is held, and its render only once read', () => {
    const before = renditionsOf(
      captureInput({
        file: file('dji_fly_0242.webp'),
        origin: proxyOver('dji_fly_0242_photo.DNG', 8064, 4536, 74e6),
        measured: { width: 2048, height: 1152 },
        sensor: null,
        original: { assetId: 'winnow.example/9', held: false },
      }),
    );
    expect(before.map((r) => r.id)).toEqual(['proxy', 'delivered:dji_fly_0242_photo.dng', 'sensor:dji_fly_0242_photo.dng']);
    // Nobody looked: the render's size is not the sensor's, and is not invented from it.
    expect(before[1].pixels).toBeNull();
    expect(before[2].pixels).toEqual({ width: 8064, height: 4536 });

    const after = renditionsOf(
      captureInput({
        file: file('dji_fly_0242.webp'),
        origin: proxyOver('dji_fly_0242_photo.DNG', 8064, 4536, 74e6),
        measured: { width: 2048, height: 1152 },
        sensor: null,
        original: { assetId: 'winnow.example/9', held: true, render: { width: 960, height: 540 } },
      }),
    );
    expect(after[1]).toMatchObject({ here: true, pixels: { width: 960, height: 540 } });
  });

  it('lists the companion behind a Sony HIF: the ARW’s render and sensor, under its own asset id', () => {
    const origin: MediaOrigin = {
      ...proxyOver('DSC08463.HIF', 7008, 4672, 12.6e6),
      companion: {
        assetId: 'winnow.example/99',
        name: 'DSC08463.ARW',
        bytes: 34.6e6,
        width: 7040,
        height: 4688,
        fetchFile: () => Promise.reject(new Error('not in a test')),
        fetchHead: () => Promise.reject(new Error('not in a test')),
      },
    };
    const chrome = (name: string) => /\.(jpe?g|png|webp)$/i.test(name);
    const rows = renditionsOf(
      captureInput({
        file: file('DSC08463.webp'),
        origin,
        measured: { width: 2048, height: 1365 },
        sensor: null,
        original: { assetId: 'winnow.example/12', held: false },
        companion: { held: false, render: { width: 7008, height: 4672 } },
        canDraw: chrome,
      }),
    );
    // The HIF row is pruned: this browser cannot draw it and the ARW's render is the same picture.
    expect(rows.map((r) => r.id)).toEqual(['proxy', 'delivered:dsc08463.arw', 'sensor:dsc08463.arw']);
    expect(rows[1]).toMatchObject({ reach: 'embedded', here: false, assetId: 'winnow.example/99', pixels: { width: 7008, height: 4672 } });
    expect(rows[2]).toMatchObject({ bytes: 34.6e6, pixels: { width: 7040, height: 4688 } });
    // Nothing of the companion is listed before the caller says what it knows of it.
    expect(renditionsOf(captureInput({ file: file('DSC08463.webp'), origin, measured: null, sensor: null, canDraw: chrome })).map((r) => r.id)).toEqual([
      'proxy',
      'delivered:dsc08463.hif',
    ]);
  });

  it('adds a folder’s siblings — the DNG beside a JPEG — and leaves an export of ours out', () => {
    const rows = renditionsOf(
      captureInput({
        file: file('DJI_0101.JPG', 9e6),
        origin: null,
        measured: { width: 8064, height: 4536 },
        sensor: null,
        siblings: [
          { file: file('DJI_0101.DNG', 74e6), facts: { software: null, render: { width: 960, height: 540 }, sensor: { width: 8064, height: 4536 } } },
          { file: file('DJI_0101.jpg', 3e6), facts: { software: 'Atelier', pixels: { width: 7728, height: 3896 } } },
        ],
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(['delivered:dji_0101.dng', 'delivered:dji_0101.jpg', 'sensor:dji_0101.dng']);
    // The JPEG row is the file in hand, not the export of ours.
    expect(rows[1].bytes).toBe(9e6);
    expect(rows.every((r) => r.here)).toBe(true);
  });
});
