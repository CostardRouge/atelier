import { describe, expect, it } from 'vitest';
import type { MediaOrigin } from './media-identity';
import { canStageDraw, readRenditions, stageChipLabel, stageChoice, stageRenditions, writeRendition } from './media-rendition';

function file(name: string, bytes = 1000): File {
  return new File([new Uint8Array(bytes)], name);
}

const proxyOver = (name: string, width: number, height: number, bytes: number, extra: Partial<MediaOrigin> = {}): MediaOrigin => ({
  sourceId: 'winnow.example',
  fidelity: 'proxy',
  width,
  height,
  name,
  bytes,
  fetchOriginal: () => Promise.reject(new Error('not in a test')),
  ...extra,
});

describe('canStageDraw', () => {
  it('draws clips and the pictures a browser draws, never a RAW as a file', () => {
    expect(canStageDraw('DJI_0001.MP4')).toBe(true);
    expect(canStageDraw('clip.mov')).toBe(true);
    expect(canStageDraw('DJI_0101.JPG')).toBe(true);
    expect(canStageDraw('DJI_0101.DNG')).toBe(false);
    expect(canStageDraw('flight.srt')).toBe(false);
  });
});

describe('stageRenditions', () => {
  it('lists a clip’s proxy and the rush itself, the rush with the capture’s pixels and weight', () => {
    const rows = stageRenditions({
      file: file('DJI_0001.mp4', 4e7),
      origin: proxyOver('DJI_0001.MP4', 3840, 2160, 1.2e9),
      measured: { width: 1280, height: 720 },
      original: { assetId: 'winnow.example/7', held: false },
    });
    expect(rows.map((r) => r.id)).toEqual(['proxy', 'delivered:dji_0001.mp4']);
    expect(rows[0].pixels).toEqual({ width: 1280, height: 720 });
    expect(rows[1]).toMatchObject({
      reach: 'file',
      here: false,
      blocked: null,
      assetId: 'winnow.example/7',
      bytes: 1.2e9,
      pixels: { width: 3840, height: 2160 },
    });
  });

  it('says the rush is in hand once the session holds it', () => {
    const rows = stageRenditions({
      file: file('DJI_0001.mp4'),
      origin: proxyOver('DJI_0001.MP4', 3840, 2160, 1.2e9),
      measured: null,
      original: { assetId: 'winnow.example/7', held: true },
    });
    expect(rows[1].here).toBe(true);
  });

  it('lists a clip of one’s own as one row — there is nothing to switch to', () => {
    const rows = stageRenditions({ file: file('DJI_0001.MP4'), origin: null, measured: { width: 3840, height: 2160 } });
    expect(rows.map((r) => r.id)).toEqual(['delivered:dji_0001.mp4']);
  });

  it('lists a still’s camera file and the render inside its RAW companion, never the sensor', () => {
    const rows = stageRenditions({
      file: file('DJI_0101.webp'),
      origin: proxyOver('DJI_0101.JPG', 8064, 4536, 9e6, {
        companion: {
          assetId: 'winnow.example/13',
          name: 'DJI_0101.DNG',
          bytes: 7.4e7,
          width: 8064,
          height: 4536,
          fetchFile: () => Promise.reject(new Error('not in a test')),
          fetchHead: () => Promise.reject(new Error('not in a test')),
        },
      }),
      measured: { width: 2048, height: 1152 },
      original: { assetId: 'winnow.example/12', held: false },
      companion: { held: false, render: { width: 960, height: 540 } },
    });
    expect(rows.map((r) => r.id)).toEqual(['proxy', 'delivered:dji_0101.dng', 'delivered:dji_0101.jpg']);
    expect(rows.find((r) => r.id === 'delivered:dji_0101.dng')).toMatchObject({
      reach: 'embedded',
      pixels: { width: 960, height: 540 },
    });
    expect(rows.some((r) => r.role === 'sensor')).toBe(false);
  });
});

describe('stageChoice', () => {
  const rows = stageRenditions({
    file: file('DJI_0001.mp4'),
    origin: proxyOver('DJI_0001.MP4', 3840, 2160, 1.2e9),
    measured: null,
    original: { assetId: 'winnow.example/7', held: false },
  });

  it('opens on the proxy when nothing is stored', () => {
    expect(stageChoice(rows, null)).toEqual({ current: rows[0], wanted: null });
  });

  it('brings the stored file onto the stage', () => {
    expect(stageChoice(rows, 'delivered:dji_0001.mp4')).toEqual({ current: rows[1], wanted: rows[1] });
  });

  it('falls back to where the media opens for an id the capture no longer offers', () => {
    expect(stageChoice(rows, 'delivered:dji_0002.mp4')).toEqual({ current: rows[0], wanted: null });
  });

  it('never wants a blocked row', () => {
    const blocked = rows.map((r) => (r.role === 'delivered' ? { ...r, blocked: 'no' } : r));
    expect(stageChoice(blocked, 'delivered:dji_0001.mp4').wanted).toBeNull();
  });
});

describe('writeRendition', () => {
  it('stores a delivered file under the media’s key, and nothing for where it opens', () => {
    const one = writeRendition({}, 'DJI_0001', 'delivered:dji_0001.mp4');
    expect(one).toEqual({ DJI_0001: 'delivered:dji_0001.mp4' });
    expect(writeRendition(one, 'DJI_0001', null)).toEqual({});
    expect(writeRendition(one, 'DJI_0001', 'proxy')).toEqual({});
  });

  it('hands back the same map when nothing changed, so no autosave is owed', () => {
    const one = { DJI_0001: 'delivered:dji_0001.mp4' };
    expect(writeRendition(one, 'DJI_0001', 'delivered:dji_0001.mp4')).toBe(one);
    expect(writeRendition(one, 'DJI_0002', null)).toBe(one);
  });
});

describe('readRenditions', () => {
  it('keeps only ids that name a delivered file', () => {
    expect(
      readRenditions({ a: 'delivered:a.mp4', b: 'proxy', c: 3, d: 'sensor:d.dng' }),
    ).toEqual({ a: 'delivered:a.mp4' });
    expect(readRenditions(undefined)).toEqual({});
    expect(readRenditions(['delivered:a.mp4'])).toEqual({});
  });
});

describe('stageChipLabel', () => {
  const rows = stageRenditions({
    file: file('DJI_0101.webp'),
    origin: proxyOver('DJI_0101.JPG', 8064, 4536, 9e6, {
      companion: {
        assetId: 'winnow.example/13',
        name: 'DJI_0101.DNG',
        bytes: 7.4e7,
        width: 8064,
        height: 4536,
        fetchFile: () => Promise.reject(new Error('not in a test')),
        fetchHead: () => Promise.reject(new Error('not in a test')),
      },
    }),
    measured: null,
    original: { assetId: 'winnow.example/12', held: false },
    companion: { held: false },
  });
  const label = (id: string, base = 'DJI_0101') => stageChipLabel(rows.find((r) => r.id === id)!, base);

  it('says the type of a file named after the media, beside the name already drawn', () => {
    expect(label('proxy')).toBe('Proxy');
    expect(label('delivered:dji_0101.jpg')).toBe('JPEG');
    expect(label('delivered:dji_0101.dng')).toBe('DNG render');
  });

  it('says the whole name of a file named otherwise', () => {
    expect(label('delivered:dji_0101.jpg', 'sunset')).toBe('DJI_0101.JPG');
  });
});
