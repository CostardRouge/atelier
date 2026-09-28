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
  fixedFrameDelivery,
  exportName,
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
  it('accepts what a browser or a shipped decoder reads and refuses a RAW or a TIFF', () => {
    expect(decodableOriginal('a.JPG')).toBe(true);
    expect(decodableOriginal('a.png')).toBe(true);
    expect(decodableOriginal('a.webp')).toBe(true);
    expect(decodableOriginal('a.DNG')).toBe(false);
    expect(decodableOriginal('a.ARW')).toBe(false);
    expect(decodableOriginal('a.heic')).toBe(true);
    expect(decodableOriginal('a.HIF')).toBe(true);
    expect(decodableOriginal('a.jxl')).toBe(true);
    expect(decodableOriginal('a.tif')).toBe(false);
    expect(decodableOriginal(null)).toBe(false);
  });
});

describe('choosePixels', () => {
  it('has nothing to choose for a file that is the original', () => {
    expect(choosePixels('auto', 0.5, null)).toEqual({ from: 'file', reason: null });
    expect(choosePixels('proxies', 0.5, null)).toEqual({ from: 'file', reason: null });
  });

  it('refuses a RAW whose render has not been measured — never on the assumption it is full-size', () => {
    const raw = { ...original, name: 'DJI_0421.DNG' };
    for (const mode of ['auto', 'proxies'] as const) {
      expect(choosePixels(mode, 0.5, raw, proxy).from).toBe('file');
    }
    expect(choosePixels('auto', 0.5, raw, proxy).reason).toMatch(/read from the file’s head at export/);
  });

  it('takes the proxy over a SMALLER embedded render — the DJI, measured', () => {
    // 960 × 540 inside the file, 2048 px of proxy: fetching 74 MB would
    // deliver 0.52 megapixels.
    const raw = { ...original, name: 'DJI_0421.DNG', render: { width: 960, height: 540 } };
    expect(choosePixels('auto', 0.5, raw, proxy).from).toBe('file');
    expect(choosePixels('auto', 0.5, raw, proxy).reason).toBe(
      'its original is a RAW whose own render is 960 px against the proxy’s 2048 — the proxy is what leaves',
    );
  });

  it('takes a LARGER embedded render, and only where the frame needs it', () => {
    const raw = { ...original, name: 'DJI_0421.DNG', render: { width: 6048, height: 4032 } };
    // Auto: the proxy fills this frame, so the bigger render buys nothing.
    expect(choosePixels('auto', 1.2, raw, proxy).from).toBe('file');
    expect(choosePixels('auto', 1.2, raw, proxy).reason).toMatch(/would buy nothing here/);
    // Auto, upscaling: worth the fetch, and it says both numbers.
    expect(choosePixels('auto', 0.8, raw, proxy).from).toBe('original');
    expect(choosePixels('auto', 0.8, raw, proxy).reason).toMatch(/6048 px render inside it is larger than the 2048 px proxy/);
    expect(choosePixels('proxies', 0.5, raw, proxy).from).toBe('file');
  });

  it('Auto fetches the original only where the proxy would upscale', () => {
    expect(choosePixels('auto', 0.8, original).from).toBe('original');
    expect(choosePixels('auto', 0.8, original).reason).toMatch(/×1\.25/);
    expect(choosePixels('auto', 1.0, original).from).toBe('file');
    expect(choosePixels('auto', 2.3, original).from).toBe('file');
  });

  it('"proxies only" holds the proxy where Auto would fetch — and nothing forces a fetch (R5)', () => {
    expect(choosePixels('proxies', 0.5, original).from).toBe('file');
    expect(choosePixels('proxies', 0.5, original).reason).toBe('proxies only');
    expect(choosePixels('auto', 2.0, original).from).toBe('file');
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
  const settings = { longEdge: 1920, pixels: 'auto' as const };

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
    // The original is called by its NAME — the word the fidelity chip's menu uses for it.
    expect(s.line).toMatch(/^DJI_0421\.JPG 6048 px → 1920/);
    expect(s.reason).toMatch(/upscaled/);
  });

  it('stays on the proxy when it has the pixels, and under Proxies delivers what it has and says what was asked', () => {
    const own = deliverySummary(proxy, true, original, null, 16 / 9, null, settings);
    expect(own.from).toBe('file');
    expect(own.line).toBe('Proxy 2048 px → 1920 · ×1.07 to spare');
    const forced = deliverySummary(proxy, true, original, null, 4 / 5, null, { ...settings, pixels: 'proxies' });
    expect(forced.from).toBe('file');
    expect(forced.out).toEqual({ w: 1229, h: 1536 });
    expect(forced.line).toBe('Proxy 1536 px → 1536 · exact · asked 1920');
  });

  it('with Source size asked, Auto turns to the original: its pixels ARE the source size', () => {
    const s = deliverySummary(proxy, true, original, null, proxy.width / proxy.height, null, { longEdge: null, pixels: 'auto' });
    expect(s.from).toBe('original');
    expect(s.out).toEqual({ w: 8064, h: 6048 });
    expect(s.line).toBe('DJI_0421.JPG 8064 px → 8064 · exact');
  });

  it('a smaller crop delivers at its own density, never blown up to the aspect box', () => {
    const s = deliverySummary(proxy, false, null, { ...DEFAULT_FRAMING, scale: 1.6 }, proxy.width / proxy.height, null, settings);
    expect(s.from).toBe('file');
    expect(s.out).toEqual({ w: 1280, h: 960 });
    expect(s.line).toBe('File 1280 px → 1280 · exact');
  });

  it('counts the border in the file and says the crop it carries', () => {
    const border = { aspect: '1:1', fill: '#ffffff', margin: { x: 0.1, y: 0.1 } };
    const s = deliverySummary(proxy, false, null, null, proxy.width / proxy.height, border, { longEdge: null, pixels: 'auto' });
    // 2048 × 1536 + 10 % of 1536 each side → 2355.2 × 1843.2, squared → 2355 × 2355.
    expect(s.out).toEqual({ w: 2355, h: 2355 });
    expect(s.line).toBe('File 2048 px → 2355 · exact');
  });

  it('delivers from the proxy when the original is a RAW nobody has measured, and says why', () => {
    const s = deliverySummary(proxy, true, { ...original, name: 'DJI_0421.DNG' }, null, 4 / 5, null, settings);
    expect(s.from).toBe('file');
    expect(s.reason).toMatch(/RAW/);
    // The frame is NOT planned against the sensor: those pixels can never be
    // delivered here, so "asked 8064" would be a promise nothing can keep.
    expect(s.line).toBe('Proxy 1536 px → 1536 · exact');
  });

  it('calls a RAW original what it is — the render inside it, never the sensor', () => {
    const s = deliverySummary(
      proxy,
      true,
      { ...original, name: 'DJI_0421.DNG', render: { width: 6048, height: 4032 } },
      null,
      4 / 5,
      null,
      settings,
    );
    expect(s.from).toBe('original');
    expect(s.line).toMatch(/^DJI_0421\.DNG render /);
  });
});

describe('fixedFrameDelivery — Trips and the Studio, whose frame is the frame', () => {
  const deck = { w: 1536, h: 1920 };

  it('says the proxy is upscaled into the deck, and Auto fetches for it (F3, measured)', () => {
    const s = fixedFrameDelivery(proxy, true, original, null, deck);
    expect(s.from).toBe('original');
    expect(s.reason).toMatch(/×1\.25/);
    // The frame is written whatever happens — it is a frame, not a cap.
    expect(s.out).toEqual(deck);
    expect(s.headroom).toBeCloseTo(3.15, 2);
    expect(s.line).toMatch(/^DJI_0421\.JPG \d+ px → 1920 · ×3\.15 to spare$/);
  });

  it('holds the proxy where the frame fits it — there is no door to say otherwise (R5)', () => {
    const small = { w: 1229, h: 1536 };
    const held = fixedFrameDelivery(proxy, true, original, null, small);
    expect(held.from).toBe('file');
    expect(held.line).toBe('Proxy 1536 px → 1536 · exact');
    expect(held.reason).toBe('the proxy has the pixels this frame needs');
  });

  it('never fetches a RAW whose render is smaller than the proxy', () => {
    const raw = { ...original, name: 'DJI_0421.DNG', render: { width: 960, height: 540 } };
    const s = fixedFrameDelivery(proxy, true, raw, null, deck);
    expect(s.from).toBe('file');
    expect(s.reason).toMatch(/960 px against the proxy’s 2048/);
  });

  it('calls a file that IS the original by its own name', () => {
    const s = fixedFrameDelivery(original, false, null, null, deck);
    expect(s.from).toBe('file');
    expect(s.line).toMatch(/^File /);
    expect(s.reason).toBeNull();
  });

  it('says a RAW render is a RAW render, wherever it is measured', () => {
    const s = fixedFrameDelivery({ width: 960, height: 540, viaRawPreview: true }, false, null, null, deck);
    expect(s.line).toMatch(/^Camera render /);
  });
});

describe('names and sentences', () => {
  it('names the export EXACTLY after the picture — the pairing convention', () => {
    expect(exportName('DJI_0101.JPG')).toBe('DJI_0101.jpg');
    // The proxy's own extension never reaches the file: a JPEG leaves.
    expect(exportName('IMG_0421.webp')).toBe('IMG_0421.jpg');
    expect(exportName('a.b.tif')).toBe('a.b.jpg');
    expect(exportName('.jpg')).toBe('picture.jpg');
  });

  it('counts files and pictures apart once a run has several targets', () => {
    expect(describeRun(6, 'folder', [], 0, { pictures: 3, targets: 2 })).toBe('3 pictures × 2 targets — 6 files written');
    expect(describeRun(3, 'folder', [], 0, { pictures: 3, targets: 1 })).toBe('3 pictures written');
  });

  it('describes a run with its first failure', () => {
    expect(describeRun(3, 'folder', [])).toBe('3 pictures written');
    expect(describeRun(1, 'download', [])).toBe('1 picture downloaded');
    expect(describeRun(0, 'folder', ['a.jpg is not in the Library', 'b'])).toBe(
      'Nothing was written — a.jpg is not in the Library (+1 more)',
    );
  });

  it('says how many were numbered around a file already in the folder', () => {
    expect(describeRun(3, 'folder', [], 1)).toBe('3 pictures written · 1 numbered, the folder already held that name');
    expect(describeRun(3, 'folder', [], 2)).toBe(
      '3 pictures written · 2 numbered, the folder already held those names',
    );
    expect(describeRun(2, 'folder', ['b.jpg: no room'], 1)).toBe(
      '2 pictures written · 1 numbered, the folder already held that name — b.jpg: no room',
    );
  });
});
