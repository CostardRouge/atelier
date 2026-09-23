import { describe, expect, it } from 'vitest';
import { assetFiles, buildAssets, captureFileType, hasRawSibling, siblingTypes } from './assets';
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

  it('groups a RAW and its JPEG into one photo asset, showing the decodable half and keeping the RAW', () => {
    const assets = buildAssets([f('IMG_8801.RAF'), f('IMG_8801.JPG')]);
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('photo');
    expect(assets[0].parts.image?.name).toBe('IMG_8801.JPG');
    expect(assets[0].parts.siblings?.map((s) => s.name)).toEqual(['IMG_8801.RAF']);
  });

  it('does not let the listing order decide which half of a pair is shown', () => {
    const jpegFirst = buildAssets([f('IMG_8801.JPG'), f('IMG_8801.RAF')]);
    expect(jpegFirst[0].parts.image?.name).toBe('IMG_8801.JPG');
    expect(jpegFirst[0].parts.siblings?.map((s) => s.name)).toEqual(['IMG_8801.RAF']);
  });

  it('shows the RAW of a Sony pair, since only WebKit draws the HEIF beside it', () => {
    const assets = buildAssets([f('DSC00123.ARW'), f('DSC00123.HIF')]);
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('photo');
    expect(assets[0].parts.image?.name).toBe('DSC00123.ARW');
    expect(assets[0].parts.siblings?.map((s) => s.name)).toEqual(['DSC00123.HIF']);
    // And the other way round in the listing, which must decide nothing.
    const other = buildAssets([f('DSC00123.HIF'), f('DSC00123.ARW')])[0];
    expect(other.parts.image?.name).toBe('DSC00123.ARW');
    expect(other.parts.siblings?.map((s) => s.name)).toEqual(['DSC00123.HIF']);
  });

  it('keeps every image file of a three-file capture, and its size counts them all', () => {
    const assets = buildAssets([f('DJI_0001.DNG', 60), f('DJI_0001.JPG', 8), f('DJI_0001.HIF', 12)]);
    expect(assets).toHaveLength(1);
    expect(assets[0].parts.image?.name).toBe('DJI_0001.JPG');
    expect(assets[0].parts.siblings?.map((s) => s.name)).toEqual(['DJI_0001.DNG', 'DJI_0001.HIF']);
    expect(assets[0].size).toBe(80);
    expect(assetFiles(assets[0].parts).map((x) => x.name)).toEqual(['DJI_0001.JPG', 'DJI_0001.DNG', 'DJI_0001.HIF']);
  });

  it('says the capture’s other files by type, so a RAW beside its JPEG is never silent', () => {
    const [dji] = buildAssets([f('DJI_0101.JPG'), f('DJI_0101.DNG')]);
    expect(siblingTypes(dji.parts)).toEqual(['DNG']);
    expect(hasRawSibling(dji.parts)).toBe(true);
    // Added later, apart from its twin: still one asset, and still said.
    const [sony] = buildAssets([f('DSC00200.JPG'), f('DSC00200.ARW'), f('DSC00200.HIF')]);
    expect(siblingTypes(sony.parts)).toEqual(['ARW', 'HIF']);
    const [heifOnly] = buildAssets([f('DSC00300.JPG'), f('DSC00300.HIF')]);
    expect(hasRawSibling(heifOnly.parts)).toBe(false);
    const [lone] = buildAssets([f('DSC00123.ARW')]);
    expect(siblingTypes(lone.parts)).toEqual([]);
    expect(captureFileType('a.jpeg')).toBe('JPEG');
    expect(captureFileType('a.dng')).toBe('DNG');
    expect(captureFileType('noext')).toBe('file');
  });

  it('has no siblings on a lone picture', () => {
    expect(buildAssets([f('c.jpg')])[0].parts.siblings).toBeUndefined();
  });

  it('takes a lone HEIF as a photo all the same', () => {
    const assets = buildAssets([f('DSC00124.HIF')]);
    expect(assets).toHaveLength(1);
    expect(assets[0].kind).toBe('photo');
    expect(assets[0].parts.image?.name).toBe('DSC00124.HIF');
  });

  it('keeps a RAW as the image when it is the only one', () => {
    const assets = buildAssets([f('IMG_8801.RAF')]);
    expect(assets[0].parts.image?.name).toBe('IMG_8801.RAF');
  });

  it('keeps the first of two decodable images, deterministically', () => {
    const assets = buildAssets([f('IMG_8801.JPG'), f('IMG_8801.PNG')]);
    expect(assets[0].parts.image?.name).toBe('IMG_8801.JPG');
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
