import { describe, expect, it } from 'vitest';
import type { MediaOrigin } from '../projects/media-identity';
import { dropHeldOriginals, heldOriginal } from '../sources/original-cache';
import { deliveredSourceFor, fetchSourceFile, sensorSourceFor } from './sensor-source';

function file(name: string, bytes = 100): File {
  return new File([new Uint8Array(bytes)], name);
}

function proxyOver(name: string, extra: Partial<MediaOrigin> = {}): MediaOrigin {
  return {
    sourceId: 'winnow.example',
    fidelity: 'proxy',
    width: 8064,
    height: 4536,
    name,
    bytes: 74e6,
    fetchOriginal: () => Promise.resolve(file(name, 74)),
    ...extra,
  };
}

const companion = (name: string) => ({
  assetId: 'winnow.example/99',
  name,
  bytes: 34.6e6,
  width: 7040,
  height: 4688,
  fetchFile: () => Promise.resolve(file(name, 35)),
  fetchHead: () => Promise.resolve(new ArrayBuffer(8)),
});

describe('sensorSourceFor', () => {
  it('is the file itself when that is a RAW', () => {
    const raw = file('DSC08463.ARW');
    expect(sensorSourceFor(raw, null)).toMatchObject({ reach: 'file', held: raw, fetch: null });
  });

  it('is the RAW a folder listed beside a JPEG, in hand', () => {
    const dng = file('DJI_0101.DNG');
    const s = sensorSourceFor(file('DJI_0101.JPG'), null, [file('DJI_0101.HIF'), dng]);
    expect(s).toMatchObject({ reach: 'sibling', name: 'DJI_0101.DNG', held: dng });
  });

  it('is the proxy’s own original when that is a RAW, held under the picture’s asset id', () => {
    const s = sensorSourceFor(file('dji_fly_0242.webp'), proxyOver('dji_fly_0242_photo.DNG'), [], 'winnow.example/12');
    expect(s).toMatchObject({ reach: 'original', name: 'dji_fly_0242_photo.DNG', bytes: 74e6, key: 'winnow.example/12', held: null });
  });

  it('is the companion behind a Sony HIF or a DJI JPEG, under the companion’s own asset id', () => {
    const s = sensorSourceFor(file('DSC08463.webp'), proxyOver('DSC08463.HIF', { companion: companion('DSC08463.ARW') }), [], 'winnow.example/12');
    expect(s).toMatchObject({ reach: 'companion', name: 'DSC08463.ARW', bytes: 34.6e6, key: 'winnow.example/99', held: null });
  });

  it('never offers a companion that is not a RAW, and answers null for a plain JPEG', () => {
    expect(sensorSourceFor(file('IMG_1.webp'), proxyOver('IMG_1.HEIC', { companion: companion('IMG_1.MOV') }))).toBeNull();
    expect(sensorSourceFor(file('IMG_1.JPG'), null, [file('IMG_1.PNG')])).toBeNull();
  });
});

describe('deliveredSourceFor', () => {
  it('answers nothing for the proxy, for no choice, and for a name the capture no longer offers', () => {
    const f = file('DJI_0101.webp');
    expect(deliveredSourceFor('proxy', f, proxyOver('DJI_0101.JPG'))).toBeNull();
    expect(deliveredSourceFor(null, f, proxyOver('DJI_0101.JPG'))).toBeNull();
    expect(deliveredSourceFor('delivered:gone.jpg', f, proxyOver('DJI_0101.JPG'))).toBeNull();
  });

  it('finds the proxy’s original, the companion and a folder sibling by NAME, case aside', () => {
    const f = file('DJI_0101.webp');
    const origin = proxyOver('DJI_0101.JPG', { companion: companion('DJI_0101.DNG') });
    expect(deliveredSourceFor('delivered:dji_0101.jpg', f, origin, [], 'winnow.example/12')).toMatchObject({ reach: 'original', name: 'DJI_0101.JPG', key: 'winnow.example/12' });
    expect(deliveredSourceFor('delivered:dji_0101.dng', f, origin)).toMatchObject({ reach: 'companion', name: 'DJI_0101.DNG', key: 'winnow.example/99' });
    const dng = file('DJI_0101.DNG');
    expect(deliveredSourceFor('delivered:dji_0101.dng', file('DJI_0101.JPG'), null, [dng])).toMatchObject({ reach: 'sibling', held: dng });
  });

  it('is the file itself when the name is its own — and not when that file is a proxy of the same name', () => {
    const jpg = file('DJI_0101.JPG');
    expect(deliveredSourceFor('delivered:dji_0101.jpg', jpg, null)).toMatchObject({ reach: 'file', held: jpg });
    const looksAlike = file('DJI_0101.JPG');
    expect(deliveredSourceFor('delivered:dji_0101.jpg', looksAlike, proxyOver('DJI_0101.JPG'), [], 'k')?.reach).toBe('original');
  });
});

describe('fetchSourceFile', () => {
  it('fetches once and holds the RAW for the session under its key', async () => {
    dropHeldOriginals();
    let fetched = 0;
    const origin = proxyOver('DSC08463.HIF', {
      companion: { ...companion('DSC08463.ARW'), fetchFile: () => (fetched += 1, Promise.resolve(file('DSC08463.ARW', 35))) },
    });
    const first = await fetchSourceFile(sensorSourceFor(file('DSC08463.webp'), origin)!);
    expect(first.name).toBe('DSC08463.ARW');
    expect(heldOriginal('winnow.example/99')).toBe(first);
    // Asked again, the source sees it held and fetches nothing.
    const again = sensorSourceFor(file('DSC08463.webp'), origin)!;
    expect(again.held).toBe(first);
    expect(await fetchSourceFile(again)).toBe(first);
    expect(fetched).toBe(1);
    dropHeldOriginals();
  });

  it('hands back a RAW in hand without touching the cache', async () => {
    const raw = file('X.DNG');
    expect(await fetchSourceFile(sensorSourceFor(raw, null)!)).toBe(raw);
  });
});
