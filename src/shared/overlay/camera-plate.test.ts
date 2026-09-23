import { describe, expect, it } from 'vitest';
import { cameraFacts } from '../exif/camera-facts';
import type { ExifData } from '../exif/exif-parser';
import {
  DEFAULT_CAMERA_WORDS,
  PLATE_LAYOUTS,
  cameraWordsOf,
  defaultPlateSpec,
  gridOrigin,
  monoWidth,
  plateElements,
  plateRuns,
  readPlateSpec,
  type CameraPlateSpec,
  type PlateRun,
} from './camera-plate';

const DJI: ExifData = {
  make: 'DJI',
  model: 'FC8482',
  focalLength: 6.72,
  focalLength35: 24,
  fNumber: 1.7,
  exposureTime: 1 / 240,
  iso: 100,
  exposureBias: 0,
  relativeAltitude: 118,
};

const SONY: ExifData = {
  make: 'SONY',
  model: 'ILCE-7CM2',
  lensModel: 'FE 24-70mm F2.8 GM II',
  focalLength: 35,
  focalLength35: 35,
  fNumber: 4,
  exposureTime: 1 / 500,
  iso: 200,
  exposureBias: -0.3,
};

const ALL: CameraPlateSpec = {
  fields: ['body', 'lens', 'focal35', 'aperture', 'shutter', 'iso', 'ev', 'altitude'],
  layout: 'line',
  place: 'badge',
  size: 1,
};

const spec = (over: Partial<CameraPlateSpec>): CameraPlateSpec => ({ ...ALL, ...over });

/** A run's horizontal extent in U, relative to the plate's reference, when it is mono. */
function extent(r: PlateRun): [number, number] {
  const w = monoWidth(r.text, r.size, r.letterSpacingEm ?? 0);
  if (r.align === 'left') return [r.x, r.x + w];
  if (r.align === 'right') return [r.x - w, r.x];
  return [r.x - w / 2, r.x + w / 2];
}

describe('plateRuns', () => {
  it('is absent when none of the chosen fields is recorded — never a blank plate', () => {
    for (const layout of PLATE_LAYOUTS) {
      expect(
        plateRuns(cameraFacts({}), spec({ layout: layout.id }), DEFAULT_CAMERA_WORDS, 'left'),
      ).toBeNull();
    }
    expect(
      plateRuns(cameraFacts(DJI), spec({ fields: ['lens'] }), DEFAULT_CAMERA_WORDS, 'left'),
    ).toBeNull();
  });

  it('sets the line as one run, the facts joined in the chosen order', () => {
    const p = plateRuns(cameraFacts(SONY), spec({ fields: ['iso', 'aperture'] }), DEFAULT_CAMERA_WORDS, 'right')!;
    expect(p.runs).toHaveLength(1);
    expect(p.runs[0]).toMatchObject({ text: 'ISO 200 · ƒ/4', align: 'right', x: 0, size: 1 });
    expect(p.height).toBe(1);
  });

  it('draws something for every layout over a real picture', () => {
    for (const layout of PLATE_LAYOUTS) {
      const p = plateRuns(cameraFacts(SONY), spec({ layout: layout.id }), DEFAULT_CAMERA_WORDS, 'left')!;
      expect(p.runs.length).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      for (const r of p.runs) expect(r.text.trim()).not.toBe('');
    }
  });

  it("never lets a plate's columns touch, whatever the alignment", () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const p = plateRuns(cameraFacts(SONY), spec({ layout: 'plate' }), DEFAULT_CAMERA_WORDS, align)!;
      const values = p.runs.filter((r) => r.font === 'mono' && r.size === 1.5).map(extent);
      for (let i = 1; i < values.length; i++) expect(values[i][0]).toBeGreaterThan(values[i - 1][1]);
    }
  });

  it('ends a right-aligned plate on its reference, and starts a left one there', () => {
    const right = plateRuns(cameraFacts(SONY), spec({ layout: 'ledger' }), DEFAULT_CAMERA_WORDS, 'right')!;
    const left = plateRuns(cameraFacts(SONY), spec({ layout: 'ledger' }), DEFAULT_CAMERA_WORDS, 'left')!;
    expect(Math.max(...right.runs.map((r) => extent(r)[1]))).toBeCloseTo(0, 9);
    expect(Math.min(...left.runs.map((r) => extent(r)[0]))).toBeCloseTo(0, 9);
  });

  it("keeps a ledger's labels clear of its values on every row", () => {
    const p = plateRuns(cameraFacts(SONY), spec({ layout: 'ledger' }), DEFAULT_CAMERA_WORDS, 'left')!;
    for (let i = 0; i < p.runs.length; i += 2) {
      expect(extent(p.runs[i])[1]).toBeLessThan(extent(p.runs[i + 1])[0]);
    }
  });

  it('labels with the trip’s own words', () => {
    const words = cameraWordsOf({ tags: { ...DEFAULT_CAMERA_WORDS.tags, aperture: 'Ouverture' } });
    const p = plateRuns(cameraFacts(SONY), spec({ layout: 'ledger', fields: ['aperture'] }), words, 'left')!;
    expect(p.runs[0].text).toBe('OUVERTURE');
    const caption = plateRuns(
      cameraFacts(SONY),
      spec({ layout: 'caption', fields: ['body', 'iso'] }),
      { ...words, shotOn: 'Pris au' },
      'left',
    )!;
    expect(caption.runs[0]).toMatchObject({ text: 'Pris au SONY ILCE-7CM2', font: 'serif', italic: true });
  });

  it('shows a viewfinder the exposure only, and its meter even at zero', () => {
    const p = plateRuns(cameraFacts(DJI), spec({ layout: 'viewfinder' }), DEFAULT_CAMERA_WORDS, 'left')!;
    const texts = p.runs.map((r) => r.text);
    expect(texts).toContain('F1.7');
    expect(texts).toContain('ISO100');
    expect(texts.some((t) => t.includes('DJI'))).toBe(false);
    const marker = p.runs.find((r) => r.text === '▲')!;
    const scale = p.runs.find((r) => r.text.startsWith('−'))!;
    // Zero sits under the middle tick of the scale.
    const middle = scale.x + (1 + 6 + 0.5) * 0.6 * scale.size;
    expect(marker.x).toBeCloseTo(middle, 9);
  });

  it('puts the meter where the camera was argued with', () => {
    const p = plateRuns(cameraFacts(SONY), spec({ layout: 'viewfinder' }), DEFAULT_CAMERA_WORDS, 'left')!;
    const marker = p.runs.find((r) => r.text === '▲')!;
    const scale = p.runs.find((r) => r.text.startsWith('−'))!;
    // −0.3 EV is one third below zero: tick 5.
    expect(marker.x).toBeCloseTo(scale.x + (1 + 5 + 0.5) * 0.6 * scale.size, 9);
  });

  it('binds an edge bar to the top or bottom, whatever it was placed as', () => {
    const bottom = plateRuns(cameraFacts(SONY), spec({ layout: 'bar', place: 'badge' }), DEFAULT_CAMERA_WORDS, 'left')!;
    expect(bottom.edge).toBe('bottom');
    const top = plateRuns(cameraFacts(SONY), spec({ layout: 'bar', place: 'top-left' }), DEFAULT_CAMERA_WORDS, 'left')!;
    expect(top.edge).toBe('top');
    expect(top.runs.map((r) => r.frameX)).toEqual([0.05, 0.95]);
  });

  it('sets an edge bar on two lines rather than let its ends meet', () => {
    const wide = plateRuns(cameraFacts(SONY), spec({ layout: 'bar' }), DEFAULT_CAMERA_WORDS, 'left', 200)!;
    expect(wide.height).toBe(1);
    expect(new Set(wide.runs.map((r) => r.y)).size).toBe(2); // one line, the mono run nudged to its baseline
    const narrow = plateRuns(cameraFacts(SONY), spec({ layout: 'bar' }), DEFAULT_CAMERA_WORDS, 'left', 30)!;
    expect(narrow.height).toBeGreaterThan(2);
    expect(narrow.runs.map((r) => r.frameX)).toEqual([0.05, 0.05]);
    expect(narrow.runs[1].y).toBeGreaterThan(narrow.runs[0].y + 1);
  });

  it('runs a margin down the side the cell names, the right by default', () => {
    const left = plateRuns(cameraFacts(SONY), spec({ layout: 'margin', place: 'top-left' }), DEFAULT_CAMERA_WORDS, 'center')!;
    expect(left.edge).toBe('left');
    expect(left.place).toBe('top-left');
    expect(left.runs.every((r) => r.align === 'left')).toBe(true);
    const dflt = plateRuns(cameraFacts(SONY), spec({ layout: 'margin' }), DEFAULT_CAMERA_WORDS, 'left')!;
    expect(dflt.edge).toBe('right');
    expect(dflt.place).toBe('center-right');
  });
});

describe('plateElements', () => {
  it('pins the faces a column depends on, and leaves the theme the rest', () => {
    const p = plateRuns(cameraFacts(SONY), spec({ layout: 'plate' }), DEFAULT_CAMERA_WORDS, 'left')!;
    const els = plateElements(p, { x: 0.1, top: 0.5 }, 0.02, 4 / 5, 'piece:exif');
    const mono = els.filter((e) => e.fontFamily === 'JetBrains Mono');
    expect(mono.length).toBeGreaterThan(0);
    for (const e of mono) expect(e.styleOverrides).toEqual(expect.arrayContaining(['fontFamily', 'letterSpacing']));
    const identity = els[0];
    expect(identity.styleOverrides).not.toContain('fontFamily');
    expect(els.map((e) => e.id)).toEqual(els.map((_, i) => (i === 0 ? 'piece:exif' : `piece:exif:${i}`)));
  });

  it('measures across in the width and down in the height, on any aspect', () => {
    const run: PlateRun = { text: 'x', x: 10, y: 10, size: 1, align: 'left', font: 'theme' };
    const plate = { runs: [run], height: 1, place: 'badge' as const, edge: null };
    const portrait = plateElements(plate, { x: 0, top: 0 }, 0.01, 9 / 16, 'p')[0];
    const landscape = plateElements(plate, { x: 0, top: 0 }, 0.01, 16 / 9, 'p')[0];
    // 0.1 of the shorter side: the width on a portrait frame, the height on a landscape one.
    expect(portrait.x).toBeCloseTo(0.1, 9);
    expect(portrait.y).toBeCloseTo(0.1 * (9 / 16), 9);
    expect(landscape.x).toBeCloseTo(0.1 * (9 / 16), 9);
    expect(landscape.y).toBeCloseTo(0.1, 9);
  });
});

describe('gridOrigin', () => {
  it("hangs a plate from its cell's column and row, inside the frame", () => {
    const p = plateRuns(cameraFacts(SONY), spec({ layout: 'tiers', place: 'bottom-right' }), DEFAULT_CAMERA_WORDS, 'right')!;
    const o = gridOrigin(p, 0.02, 4 / 5);
    expect(o.align).toBe('right');
    expect(o.x).toBeCloseTo(0.93, 9);
    expect(o.top).toBeLessThan(0.92);
    expect(o.top).toBeGreaterThan(0.5);
  });
});

describe('readPlateSpec', () => {
  it('lands junk on the defaults, field by field', () => {
    expect(readPlateSpec(null)).toEqual(defaultPlateSpec());
    expect(
      readPlateSpec({ fields: ['iso', 'nope', 'iso'], layout: 'poster', place: 'middle', size: 9 }),
    ).toEqual({ fields: ['iso'], layout: 'line', place: 'badge', size: 1.8 });
    expect(readPlateSpec({ place: 'top-left', layout: 'ledger' })).toMatchObject({
      place: 'top-left',
      layout: 'ledger',
    });
  });
});

describe('cameraWordsOf', () => {
  it('fills every blank word with the English default', () => {
    expect(cameraWordsOf(null)).toEqual(DEFAULT_CAMERA_WORDS);
    expect(cameraWordsOf({ shotOn: '  ', tags: { iso: '' } as never })).toEqual(DEFAULT_CAMERA_WORDS);
  });
});
