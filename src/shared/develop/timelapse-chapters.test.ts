import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { journalRoll } from './journal';
import { createLayer } from './layer';
import { addPictures, createRollDoc, patchPicture, type RollDoc, type RollPicture } from './roll-types';
import {
  CAMERA_MAX_ZOOM,
  WHOLE_PICTURE,
  cameraFor,
  describeChange,
  describeLook,
  keepCount,
  keptChapters,
  pictureChapters,
} from './timelapse-chapters';

let n = 0;
function roll(): RollDoc {
  return addPictures(createRollDoc('R', 'local', 1, 'r'), [{ name: 'a.jpg', size: 1, lastModified: 1 }], 2, () => `p${++n}`);
}
const exposure = (ev: number, more: Partial<typeof DEFAULT_DEVELOP> = {}) => ({ ...DEFAULT_DEVELOP, exposure: ev, ...more });
const heal = (id: string, x: number, y: number) => ({ id, kind: 'heal' as const, x, y, radius: 0.02, feather: 0.5, dx: 0.03, dy: 0 });

/** The roll after a list of timed writes to its one picture. */
function edited(writes: [number, Partial<RollPicture>][]): RollPicture {
  let doc = roll();
  const id = doc.pictures[0].id;
  for (const [at, patch] of writes) doc = journalRoll(doc, patchPicture(doc, id, patch as never, at), at);
  return doc.pictures[0];
}

describe('chapters', () => {
  it('fold consecutive steps of one section into one chapter, captioned as a difference', () => {
    const p = edited([
      [1000, { develop: exposure(0.2) }],
      [3000, { develop: exposure(0.5) }],
      [5000, { develop: exposure(0.7, { highlights: -40 }) }],
      [9000, { aspect: '4:5' }],
      [12000, { develop: exposure(0.7, { highlights: -40, vibrance: 15 }) }],
    ]);
    const { chapters, recorded } = pictureChapters(p);
    expect(recorded).toBe(true);
    expect(chapters.map((c) => [c.section, c.caption])).toEqual([
      ['develop', '+0.7 EV · highlights −40'],
      ['crop', 'Crop 4:5'],
      ['develop', 'vibrance +15'],
    ]);
    expect(chapters[0].before.develop).toBeNull();
    expect(chapters[0].after.develop).toEqual(exposure(0.7, { highlights: -40 }));
    expect(chapters[1].before).toBe(chapters[0].after);
    expect(chapters[2].after.develop?.vibrance).toBe(15);
  });

  it('drop a run that ends where it started, and say how a step came to be', () => {
    const p = edited([
      [1000, { develop: exposure(0.5) }],
      [1200, { develop: null }],
      [5000, { aspect: '1:1' }],
    ]);
    const { chapters, asShot } = pictureChapters(p);
    expect(chapters.map((c) => c.section)).toEqual(['crop']);
    // The chain closes over the dropped run: the crop starts from the picture as shot.
    expect(chapters[0].before).toBe(asShot);
    const applied = { ...p, journal: [...(p.journal ?? []), { at: 9000, sections: ['look' as const], after: { look: { layers: [{ id: 'l', source: 'builtin', name: 'Portra 400', customText: null, intensity: 0.8, enabled: true }], output: 'none' as const, film: null } }, via: 'apply' as const }] };
    const { chapters: more } = pictureChapters(applied);
    expect(more[1].caption).toBe('Portra 400 · 80 % · from another picture');
  });

  it('keep the chain of states whole across a put-back and a step that changed nothing', () => {
    const p = edited([
      [1000, { develop: exposure(0.5) }],
      [5000, { aspect: '1:1' }],
      // A slider moved and put back inside one coalescing window: a step whose run ends where it started.
      [9000, { develop: exposure(0.2) }],
      [9100, { develop: exposure(0.5) }],
      // A write that changes nothing.
      [12000, { aspect: '1:1' }],
      [15000, { vignette: { amount: -30, midpoint: 50, roundness: 0, feather: 50, highlights: 0 } }],
    ]);
    const { chapters, asShot } = pictureChapters(p);
    expect(chapters.map((c) => c.section)).toEqual(['develop', 'crop', 'vignette']);
    expect(chapters[0].before).toBe(asShot);
    expect(chapters.every((c, i) => i === 0 || c.before === chapters[i - 1].after)).toBe(true);
  });

  it('caption each section in its own words', () => {
    const base = roll().pictures[0];
    const after = (patch: Partial<RollPicture>): RollPicture => ({ ...base, ...patch });
    expect(describeChange('develop', base, after({ develop: exposure(0, { contrast: 12, curves: { luma: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] } as never }) }))).toBe('contrast +12 · curve luma');
    expect(describeChange('develop', after({ develop: exposure(0.7) }), base)).toBe('Back to as shot');
    expect(describeLook({ layers: [{ id: 'a', source: 'x', name: 'Kodak 2383', customText: null, intensity: 1, enabled: true }], output: 'rec709-to-srgb', film: null })).toBe('Kodak 2383 · Rec.709 2.4 → sRGB');
    expect(describeChange('crop', base, after({ aspect: '4:5', framing: { scale: 1, x: 0, y: 0, rotation: -2, flipX: false, flipY: false, fit: 'cover' } }))).toBe('Crop 4:5 · straighten −2.0°');
    expect(describeChange('crop', base, after({ framing: { scale: 1, x: 0, y: 0, rotation: 90, flipX: true, flipY: false, fit: 'cover' } }))).toBe('Crop · turned +90° · flipped');
    expect(describeChange('repair', base, after({ repair: [heal('a', 0.5, 0.5), heal('b', 0.6, 0.5), { ...heal('c', 0.7, 0.5), kind: 'clone' }] }))).toBe('Heal ×2 · Clone ×1');
    const sky = { ...createLayer('linear', 'l1'), name: 'Sky', develop: exposure(-0.6) };
    expect(describeChange('layers', base, after({ layers: [sky] }))).toBe('Sky · −0.6 EV');
    expect(describeChange('detail', base, after({ detail: { luminance: 0, colour: 0, defringe: 0, sharpen: 30, sharpenRadius: 1, sharpenDetail: 25, sharpenMasking: 0, texture: 0, clarity: 0, dehaze: 0 } as never }))).toBe('sharpen +30');
    expect(describeChange('vignette', base, after({ vignette: { amount: -30, midpoint: 50, roundness: 0, feather: 50, highlights: 0 } }))).toBe('Vignette −30');
  });

  it('read the camera in the step: a heal zooms to its discs, a band shows the whole picture', () => {
    const p = edited([[1000, { repair: [heal('a', 0.66, 0.18)] }]]);
    const { chapters } = pictureChapters(p, 4 / 3);
    const region = chapters[0].region!;
    expect(region.x).toBeGreaterThan(0.6);
    expect(region.x + region.w).toBeLessThan(0.78);
    const cam = cameraFor(region);
    expect(cam.z).toBe(CAMERA_MAX_ZOOM);
    expect(cam.cx).toBeCloseTo(region.x + region.w / 2, 2);
    expect(cam.cy).toBeCloseTo(region.y + region.h / 2, 2);
    // The window stays inside the picture near an edge.
    const edge = pictureChapters(edited([[1000, { repair: [heal('a', 0.5, 0.03)] }]]), 4 / 3).chapters[0].region;
    expect(cameraFor(edge).cy).toBeCloseTo(0.5 / CAMERA_MAX_ZOOM, 2);

    const band = edited([[1000, { layers: [createLayer('linear', 'l1')] }]]);
    expect(pictureChapters(band).chapters[0].region).toBeNull();
    expect(cameraFor(null)).toEqual(WHOLE_PICTURE);

    const radial = edited([[1000, { layers: [{ ...createLayer('radial', 'l2'), develop: exposure(1) }] }]]);
    const r = pictureChapters(radial, 1).chapters[0].region!;
    expect(r.w).toBeGreaterThan(0.5);
    expect(cameraFor(r).z).toBeLessThan(1.5);
  });

  it('keep as many chapters as the length allows, the lightest folding into the next', () => {
    expect([keepCount(15), keepCount(30), keepCount(60), keepCount(6), keepCount(120)]).toEqual([5, 8, 14, 2, 24]);
    const p = edited([
      [1000, { develop: exposure(0.7) }],
      [3000, { detail: { luminance: 0, colour: 0, defringe: 0, sharpen: 30, sharpenRadius: 1, sharpenDetail: 25, sharpenMasking: 0, texture: 0, clarity: 0, dehaze: 0 } as never }],
      [5000, { aspect: '4:5' }],
      [7000, { repair: [heal('a', 0.5, 0.5)] }],
      [9000, { vignette: { amount: -30, midpoint: 50, roundness: 0, feather: 50, highlights: 0 } }],
    ]);
    const { chapters } = pictureChapters(p);
    expect(chapters).toHaveLength(5);
    const kept = keptChapters(chapters, 3);
    expect(kept.map((c) => c.section)).toEqual(['develop', 'crop', 'repair']);
    // The detail chapter folded into the crop that follows it; the trailing vignette into the last.
    expect(kept[1].absorbed).toEqual(['detail']);
    expect(kept[1].before).toBe(chapters[0].after);
    expect(kept[1].caption).toBe('Crop 4:5 · + detail');
    expect(kept[2].absorbed).toEqual(['vignette']);
    expect(kept[2].after).toBe(chapters[4].after);
    // The chain of states is continuous.
    expect(kept.every((c, i) => i === 0 || c.before === kept[i - 1].after)).toBe(true);
    // A hidden chapter folds the same way, whatever the count.
    const hidden = keptChapters(chapters, 10, new Set([chapters[0].id]));
    expect(hidden.map((c) => c.section)).toEqual(['detail', 'crop', 'repair', 'vignette']);
    expect(hidden[0].before).toBe(chapters[0].before);
    expect(keptChapters(chapters, 10)).toEqual(chapters);
  });

  it('tell an unrecorded picture in the standard order and say so', () => {
    const old = { ...roll().pictures[0], develop: exposure(1), aspect: '1:1' };
    const { chapters, recorded, reconstructed } = pictureChapters(old);
    expect(recorded).toBe(false);
    expect(reconstructed).toEqual(['crop', 'develop']);
    expect(chapters.map((c) => [c.section, c.via])).toEqual([['crop', 'earlier'], ['develop', 'earlier']]);
  });
});
