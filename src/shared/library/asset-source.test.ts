import { describe, expect, it } from 'vitest';
import { buildAssets } from './assets';
import { assetRemoteId, assetSourceId, splitAssetsBySource } from './asset-source';
import { registerMediaIdentity } from '../projects/media-identity';

const file = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { lastModified: 1_000 });

describe('provenance of a pool asset', () => {
  it('reads a file nobody vouched for as local', () => {
    const [asset] = buildAssets([file('IMG_0001.JPG')]);
    expect(assetSourceId(asset)).toBe('local');
    expect(assetRemoteId(asset)).toBeNull();
  });

  it('reads the source and the remote id a fetched file was vouched with', () => {
    const clip = file('DJI_0042.mp4');
    const log = file('DJI_0042.SRT', 3);
    registerMediaIdentity(clip, {
      assetId: 'winnow.example/42',
      hash: 'abc',
      origin: { sourceId: 'winnow.example', fidelity: 'proxy', width: 3840, height: 2160 },
    });
    // The log shares the identity but carries no origin — the clip speaks.
    registerMediaIdentity(log, { assetId: 'winnow.example/42', hash: 'abc' });
    const [asset] = buildAssets([clip, log]);
    expect(asset.kind).toBe('video+telemetry');
    expect(assetSourceId(asset)).toBe('winnow.example');
    expect(assetRemoteId(asset)).toBe('winnow.example/42');
  });

  it('splits the pool by source, local first, pool order kept inside each group', () => {
    const a = file('A.JPG');
    const b = file('B.webp');
    const c = file('C.JPG');
    const d = file('D.webp');
    registerMediaIdentity(b, {
      assetId: 'winnow.example/2',
      origin: { sourceId: 'winnow.example', fidelity: 'proxy', width: null, height: null },
    });
    registerMediaIdentity(d, {
      assetId: 'other.example/4',
      origin: { sourceId: 'other.example', fidelity: 'proxy', width: null, height: null },
    });
    const split = splitAssetsBySource(buildAssets([a, b, c, d]));
    expect(split.local.map((x) => x.baseName)).toEqual(['A', 'C']);
    expect([...split.remote.keys()]).toEqual(['winnow.example', 'other.example']);
    expect(split.remote.get('winnow.example')?.map((x) => x.baseName)).toEqual(['B']);
  });
});
