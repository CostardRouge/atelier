import { describe, expect, it } from 'vitest';
import { buildAssets } from './assets';
import {
  assetUsableBy,
  selectedUsableAssets,
  usableAssets,
} from './capabilities';

/** Build a fake File with a given name (and a stable-ish size). */
function f(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name);
}

describe('buildAssets', () => {
  it('pairs a video with its SRT sibling into one video+telemetry asset', () => {
    const assets = buildAssets([f('DJI_0001.MP4'), f('DJI_0001.SRT')]);
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('video+telemetry');
    expect(assets[0].parts.video?.name).toBe('DJI_0001.MP4');
    expect(assets[0].parts.srt?.name).toBe('DJI_0001.SRT');
  });

  it('classifies a lone video, a lone SRT, and a photo', () => {
    const assets = buildAssets([f('a.mov'), f('b.srt'), f('c.jpg')]);
    const byId = Object.fromEntries(assets.map((a) => [a.id, a.kind]));
    expect(byId).toEqual({ a: 'video', b: 'telemetry', c: 'photo' });
  });

  it('groups a RAW and its JPEG into one photo asset', () => {
    const assets = buildAssets([f('IMG_8801.RAF'), f('IMG_8801.JPG')]);
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('photo');
    expect(assets[0].parts.image?.name).toBe('IMG_8801.RAF');
  });

  it('pairs case-insensitively on the base name', () => {
    const assets = buildAssets([f('Clip01.mp4'), f('CLIP01.srt')]);
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('video+telemetry');
  });

  it('ignores junk: proxies, thumbnails and hidden dotfiles', () => {
    const assets = buildAssets([
      f('DJI_0001.MP4'),
      f('DJI_0001.LRF'),
      f('DJI_0001.THM'),
      f('.DS_Store'),
    ]);
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('video');
  });

  it('sums part sizes and sorts by base name', () => {
    const assets = buildAssets([f('b.mp4', 5), f('a.mp4', 3), f('a.srt', 2)]);
    expect(assets.map((a) => a.baseName)).toEqual(['a', 'b']);
    expect(assets[0].size).toBe(5); // a.mp4 + a.srt
  });
});

describe('capabilities', () => {
  const assets = buildAssets([
    f('DJI_0001.MP4'),
    f('DJI_0001.SRT'), // video+telemetry
    f('broll.mov'), // video
    f('shot.jpg'), // photo
  ]);

  it('lets a video tool use plain videos and video+telemetry assets', () => {
    const usable = usableAssets(['video'], assets).map((a) => a.id);
    expect(usable.sort()).toEqual(['broll', 'dji_0001']);
  });

  it('matches a photo tool to photos only', () => {
    expect(usableAssets(['photo'], assets).map((a) => a.id)).toEqual(['shot']);
  });

  it('matches a telemetry tool to video+telemetry (and lone srt)', () => {
    const a = assets.find((x) => x.id === 'dji_0001')!;
    expect(assetUsableBy(['video+telemetry', 'telemetry'], a)).toBe(true);
  });

  it('intersects usability with the current selection', () => {
    const selection = new Set(['broll', 'shot']);
    const picked = selectedUsableAssets(['video'], assets, selection);
    expect(picked.map((a) => a.id)).toEqual(['broll']);
  });
});
