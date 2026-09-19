import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING } from '../media/framing';
import {
  choosePixels,
  decodableOriginal,
  deliversLine,
  cropZoneSize,
  deliveredLayout,
  deliverySummary,
  describeRun,
  exportName,
  longEdgeChoiceId,
  pixelHeadroom,
  rollOutputSize,
} from './roll-export';

const proxy = { width: 2048, height: 1536 };
const original = { width: 8064, height: 6048, name: 'DJI_0421.JPG', bytes: 24_000_000 };

describe('rollOutputSize', () => {
  it('keeps the source itself for its own aspect, capped to the long edge', () => {
    expect(rollOutputSize(proxy, proxy.width / proxy.height, null)).toEqual({ w: 2048, h: 1536 });
    expect(rollOutputSize(proxy, proxy.width / proxy.height, 1024)).toEqual({ w: 1024, h: 768 });
  });

  it('never upscales past the source', () => {
    expect(rollOutputSize(proxy, proxy.width / proxy.height, 4096)).toEqual({ w: 2048, h: 1536 });
  });

  it('cover-crops a preset at the source density (a landscape proxy to 4:5 keeps 1229 px of width)', () => {
    expect(rollOutputSize(proxy, 4 / 5, null)).toEqual({ w: 1229, h: 1536 });
    expect(rollOutputSize(proxy, 4 / 5, 1920)).toEqual({ w: 1229, h: 1536 });
    expect(rollOutputSize(original, 4 / 5, 1920)).toEqual({ w: 1536, h: 1920 });
  });

  it('is empty for an empty source', () => {
    expect(rollOutputSize({ width: 0, height: 0 }, 1, null)).toEqual({ w: 0, h: 0 });
  });
});

describe('pixelHeadroom — F3 of develop-originals.md', () => {
  it('finds a landscape proxy cropped to 4:5 at 1920 upscaled ×1.25, the 48 MP original with ×3.15 to spare', () => {
    expect(pixelHeadroom(proxy, DEFAULT_FRAMING, { w: 1536, h: 1920 })).toBeCloseTo(0.8, 3);
    expect(pixelHeadroom(original, DEFAULT_FRAMING, { w: 1536, h: 1920 })).toBeCloseTo(3.15, 2);
  });

  it('is exact for a portrait proxy delivered at its own pixels', () => {
    expect(pixelHeadroom({ width: 1536, height: 2048 }, null, { w: 1536, h: 2048 })).toBeCloseTo(1, 6);
  });

  it('shrinks with a framing zoom', () => {
    expect(pixelHeadroom(proxy, { ...DEFAULT_FRAMING, scale: 1.6 }, { w: 1536, h: 1920 })).toBeCloseTo(0.5, 3);
  });
});

describe('decodableOriginal', () => {
  it('accepts what a browser decodes and refuses a RAW, HEIC or TIFF', () => {
    expect(decodableOriginal('a.JPG')).toBe(true);
    expect(decodableOriginal('a.png')).toBe(true);
    expect(decodableOriginal('a.webp')).toBe(true);
    expect(decodableOriginal('a.DNG')).toBe(false);
    expect(decodableOriginal('a.ARW')).toBe(false);
    expect(decodableOriginal('a.heic')).toBe(false);
    expect(decodableOriginal('a.tif')).toBe(false);
    expect(decodableOriginal(null)).toBe(false);
  });
});

describe('choosePixels', () => {
  it('has nothing to choose for a file that is the original', () => {
    expect(choosePixels('auto', 0.5, null)).toEqual({ from: 'file', reason: null });
    expect(choosePixels('originals', 0.5, null)).toEqual({ from: 'file', reason: null });
  });

  it('never fetches a RAW original — the render the person looked at is delivered (decision 4)', () => {
    const raw = { ...original, name: 'DJI_0421.DNG' };
    expect(choosePixels('originals', 0.5, raw).from).toBe('file');
    expect(choosePixels('originals', 0.5, raw).reason).toMatch(/RAW/);
  });

  it('Auto fetches the original only where the proxy would upscale', () => {
    expect(choosePixels('auto', 0.8, original).from).toBe('original');
    expect(choosePixels('auto', 0.8, original).reason).toMatch(/×1\.25/);
    expect(choosePixels('auto', 1.0, original).from).toBe('file');
    expect(choosePixels('auto', 2.3, original).from).toBe('file');
  });

  it('Proxies and Originals are one click away from Auto', () => {
    expect(choosePixels('proxies', 0.5, original).from).toBe('file');
    expect(choosePixels('originals', 2.0, original).from).toBe('original');
  });
});

describe('deliversLine', () => {
  it('is the calculator in one sentence', () => {
    expect(deliversLine('Proxy', { w: 1536, h: 1920 }, 0.8)).toBe('Proxy 1536 px → 1920 · ×1.25 upscaled');
    expect(deliversLine('Original', { w: 1536, h: 1920 }, 3.15)).toBe('Original 6048 px → 1920 · ×3.15 to spare');
    expect(deliversLine('File', { w: 2048, h: 1536 }, 1)).toBe('File 2048 px → 2048 · exact');
  });
});

describe('the delivered layout', () => {
  it('is the crop at the source’s own density, capped and never upscaled', () => {
    const d = deliveredLayout(proxy, 1, { ...DEFAULT_FRAMING, scale: 2 }, null, null);
    expect(d.zone.w).toBeCloseTo(768, 6);
    expect(d.out).toEqual({ w: 768, h: 768 });
    expect(deliveredLayout(proxy, 1, { ...DEFAULT_FRAMING, scale: 2 }, null, 512).out).toEqual({ w: 512, h: 512 });
    expect(cropZoneSize(proxy, 1, null)).toEqual({ w: 1536, h: 1536 });
  });

  it('keeps a legacy Whole framing in its aspect box', () => {
    const d = deliveredLayout(proxy, 4 / 5, { ...DEFAULT_FRAMING, fit: 'contain' }, null, null);
    expect(d.out).toEqual({ w: 1229, h: 1536 });
  });

  it('places the crop in its border, centred, on the rounded canvas', () => {
    const d = deliveredLayout(proxy, proxy.width / proxy.height, null, { aspect: null, fill: '#000000', margin: { x: 0.25, y: 0 } }, 1000);
    expect(d.out.w).toBe(1000);
    expect(d.layout.x).toBeCloseTo((d.layout.w - d.layout.pw) / 2, 9);
    expect(d.layout.w).toBeCloseTo(1000, 9);
  });
});

describe('deliverySummary', () => {
  const settings = { longEdge: 1920, originals: 'auto' as const };

  it('delivers a local file from itself and says so', () => {
    const s = deliverySummary(proxy, false, null, null, proxy.width / proxy.height, null, settings);
    expect(s.from).toBe('file');
    expect(s.out).toEqual({ w: 1920, h: 1440 });
    expect(s.line).toMatch(/^File 2048 px → 1920 · ×1\.07 to spare$/);
    expect(s.reason).toBeNull();
  });

  it('turns to the original when the proxy crop would upscale, and sizes the frame from it', () => {
    const s = deliverySummary(proxy, true, original, null, 4 / 5, null, settings);
    expect(s.from).toBe('original');
    expect(s.out).toEqual({ w: 1536, h: 1920 });
    expect(s.line).toMatch(/^Original 6048 px → 1920/);
    expect(s.reason).toMatch(/upscaled/);
  });

  it('stays on the proxy when it has the pixels, and under Proxies delivers what it has and says what was asked', () => {
    const own = deliverySummary(proxy, true, original, null, 16 / 9, null, settings);
    expect(own.from).toBe('file');
    expect(own.line).toBe('Proxy 2048 px → 1920 · ×1.07 to spare');
    const forced = deliverySummary(proxy, true, original, null, 4 / 5, null, { ...settings, originals: 'proxies' });
    expect(forced.from).toBe('file');
    expect(forced.out).toEqual({ w: 1229, h: 1536 });
    expect(forced.line).toBe('Proxy 1536 px → 1536 · exact · asked 1920');
  });

  it('with Source size asked, Auto turns to the original: its pixels ARE the source size', () => {
    const s = deliverySummary(proxy, true, original, null, proxy.width / proxy.height, null, { longEdge: null, originals: 'auto' });
    expect(s.from).toBe('original');
    expect(s.out).toEqual({ w: 8064, h: 6048 });
    expect(s.line).toBe('Original 8064 px → 8064 · exact');
  });

  it('a smaller crop delivers at its own density, never blown up to the aspect box', () => {
    const s = deliverySummary(proxy, false, null, { ...DEFAULT_FRAMING, scale: 1.6 }, proxy.width / proxy.height, null, settings);
    expect(s.from).toBe('file');
    expect(s.out).toEqual({ w: 1280, h: 960 });
    expect(s.line).toBe('File 1280 px → 1280 · exact');
  });

  it('counts the border in the file and says the crop it carries', () => {
    const border = { aspect: '1:1', fill: '#ffffff', margin: { x: 0.1, y: 0.1 } };
    const s = deliverySummary(proxy, false, null, null, proxy.width / proxy.height, border, { longEdge: null, originals: 'auto' });
    // 2048 × 1536 + 10 % of 1536 each side → 2355.2 × 1843.2, squared → 2355 × 2355.
    expect(s.out).toEqual({ w: 2355, h: 2355 });
    expect(s.line).toBe('File 2048 px → 2355 · exact');
  });

  it('delivers from the render when the original is a RAW, and says why', () => {
    const s = deliverySummary(proxy, true, { ...original, name: 'DJI_0421.DNG' }, null, 4 / 5, null, {
      ...settings,
      originals: 'originals',
    });
    expect(s.from).toBe('file');
    expect(s.reason).toMatch(/RAW/);
  });
});

describe('names and sentences', () => {
  it('names the export after the picture, never the source name itself', () => {
    expect(exportName('IMG_0421.jpg', 'original')).toBe('IMG_0421-developed.jpg');
    expect(exportName('IMG_0421.webp', '4:5')).toBe('IMG_0421-developed-4x5.jpg');
    expect(exportName('IMG_0421.jpg', 'free:1.3721')).toBe('IMG_0421-developed-crop.jpg');
    expect(exportName('.jpg', 'original')).toBe('picture-developed.jpg');
  });

  it('maps a stored long edge to a Size choice and back to source', () => {
    expect(longEdgeChoiceId(1920)).toBe('1920');
    expect(longEdgeChoiceId(null)).toBe('source');
    expect(longEdgeChoiceId(1234)).toBe('source');
  });

  it('describes a run with its first failure', () => {
    expect(describeRun(3, 'folder', [])).toBe('3 pictures written');
    expect(describeRun(1, 'download', [])).toBe('1 picture downloaded');
    expect(describeRun(0, 'folder', ['a.jpg is not in the Library', 'b'])).toBe(
      'Nothing was written — a.jpg is not in the Library (+1 more)',
    );
  });
});
