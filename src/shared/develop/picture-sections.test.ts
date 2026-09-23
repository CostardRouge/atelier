import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { createLayer } from './layer';
import { addPictures, createRollDoc, isEdited, pictureEdits, setPictureWords, type RollDoc } from './roll-types';
import {
  PICTURE_SECTIONS,
  applySections,
  copiedSettings,
  copySettings,
  readSections,
  resetSections,
  withSections,
  withoutSections,
} from './picture-sections';

let n = 0;
function roll(): RollDoc {
  return addPictures(
    createRollDoc('R', 'local', 1, 'r'),
    ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => ({ name, size: 1, lastModified: 1 })),
    2,
    () => `p${++n}`,
  );
}

/** A picture with something in every section. */
function everything(doc: RollDoc, id: string): RollDoc {
  return {
    ...doc,
    pictures: doc.pictures.map((p) =>
      p.id !== id
        ? p
        : {
            ...p,
            develop: { ...DEFAULT_DEVELOP, exposure: 1 },
            grade: { layers: [], output: 'rec709-to-srgb' as const, film: null },
            aspect: '4:5',
            framing: { scale: 1.2, x: 0.1, y: 0, rotation: 2, flipX: false, flipY: false, fit: 'cover' as const },
            border: { format: 'none', color: '#fff', blur: false, margin: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } } as never,
            keystone: { vertical: 0.2, horizontal: 0, rotate: 0, scale: 1 } as never,
            lens: { distortion: 0.1, ca: 0, vignette: 0 } as never,
            detail: { noise: 0.3, color: 0, defringe: 0, sharpen: 0, radius: 1 } as never,
            vignette: { amount: -30, midpoint: 50, roundness: 0, feather: 50, highlights: 0 },
            repair: [{ id: 'x', x: 0.5, y: 0.5, r: 0.02, dx: 0.03, dy: 0, mode: 'heal', feather: 0.5 }] as never,
            layers: [createLayer('linear', 'l1')],
          },
    ),
  };
}

describe('picture sections', () => {
  it('name exactly what "edited" names — one vocabulary', () => {
    const doc = everything(roll(), 'p' + (n - 2));
    const p = doc.pictures[0];
    expect(pictureEdits(p)).toEqual(PICTURE_SECTIONS.map((s) => s.id));
  });

  it('copy only the ticked sections, as copies, and never the file, the base or the words', () => {
    const doc = everything(roll(), 'p' + (n - 2));
    const [src, dst] = doc.pictures;
    const target = { ...setPictureWords(doc, dst.id, { title: 'mine' }).pictures[1], rendition: 'proxy', develop: { ...DEFAULT_DEVELOP, base: 'gain' as const, rawGain: 1.3 } };
    const out = withSections(target, src, ['develop', 'lens']);
    expect(out.develop).toMatchObject({ exposure: 1, base: 'gain', rawGain: 1.3 });
    expect(out.lens).toEqual(src.lens);
    expect(out.lens).not.toBe(src.lens);
    expect(out.grade).toBe(target.grade);
    expect(out.aspect).toBe('original');
    expect([out.rendition, out.title, out.deliver]).toEqual(['proxy', 'mine', 'auto']);
  });

  it('apply onto several pictures at once, skipping the source and saying when nothing changed', () => {
    const doc = everything(roll(), 'p' + (n - 2));
    const [src, b, c] = doc.pictures;
    const out = applySections(doc, src, [src.id, b.id, c.id], ['crop', 'repair'], 9);
    expect(out.pictures[1]).toMatchObject({ aspect: '4:5', repair: src.repair });
    expect(out.pictures[2].framing).toEqual(src.framing);
    expect(out.pictures[0]).toBe(src);
    expect(out.updatedAt).toBe(9);
    expect(applySections(out, src, [b.id], ['crop'])).toBe(out);
    expect(applySections(doc, src, [b.id], [])).toBe(doc);
  });

  it('reset the ticked sections to as shot, keeping a RAW base and the picture’s words', () => {
    const doc = everything(roll(), 'p' + (n - 2));
    const src = { ...doc.pictures[0], develop: { ...DEFAULT_DEVELOP, exposure: 1, base: 'gain' as const, rawGain: 2 }, title: 'T' };
    const all = PICTURE_SECTIONS.map((s) => s.id);
    const cleared = withoutSections(src, all);
    // The RAW base is material, not an edit to throw away: it survives, and is all that does.
    expect(pictureEdits(cleared)).toEqual(['develop']);
    expect(cleared.develop).toMatchObject({ base: 'gain', rawGain: 2, exposure: 0 });
    expect(isEdited(withoutSections({ ...src, develop: { ...DEFAULT_DEVELOP, exposure: 1 } }, all))).toBe(false);
    expect(cleared.title).toBe('T');
    const partial = resetSections(doc, doc.pictures[0].id, ['layers'], 5);
    expect(pictureEdits(partial.pictures[0])).not.toContain('layers');
    expect(pictureEdits(partial.pictures[0])).toContain('develop');
    expect(resetSections(partial, doc.pictures[0].id, ['layers'])).toBe(partial);
  });

  it('read a stored choice in the inspector’s order, and hold a copy that later edits do not touch', () => {
    expect(readSections(['lens', 'develop', 'nope'])).toEqual(['develop', 'lens']);
    expect(readSections('junk')).toEqual(['develop', 'look', 'lens', 'detail']);
    const doc = everything(roll(), 'p' + (n - 2));
    const p = doc.pictures[0];
    copySettings(p, ['develop']);
    (p.develop as { exposure: number }).exposure = 3;
    expect(copiedSettings()?.from.develop?.exposure).toBe(1);
    copySettings(p, []);
    expect(copiedSettings()).toBeNull();
  });
});
