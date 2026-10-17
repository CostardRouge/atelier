import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { DEFAULT_KEYSTONE } from '../render/geometry';
import { addPictures, addVariant, createRollDoc, patchPicture, type RollDoc } from './roll-types';
import { journalRoll } from './journal';
import {
  carriedIsStale,
  carriedKey,
  carriedDraws,
  carriedNeedsRasters,
  carriedOn,
  carriedSource,
  carriedWords,
  drawnEdit,
  offerWords,
  carriedPassSettings,
  carriedSections,
  offerFrom,
  offersFor,
  readCarriedEdit,
} from './carried-edit';
import { createLayer, type AdjustLayer } from './layer';
import type { SubjectMask } from '../render/mask';

const ref = (name: string) => ({ name, size: 100, lastModified: 1 });

function roll(id = 'r1', updatedAt = 2): RollDoc {
  let n = 0;
  const doc = addPictures(createRollDoc(`Roll ${id}`, 'local', 1, id), [ref('a.jpg'), ref('b.jpg')], updatedAt, () => `${id}p${++n}`);
  return doc;
}
const pic = (doc: RollDoc, id: string) => doc.pictures.find((p) => p.id === id)!;
const keystone = { ...DEFAULT_KEYSTONE, vertical: 12 };

describe('what a Develop picture carries into a host', () => {
  it('hands the develop and the look to the host’s own fields and the passes as a carried edit', () => {
    const doc = patchPicture(roll(), 'r1p1', { develop: { ...DEFAULT_DEVELOP, exposure: 1 }, keystone, aspect: '4:5' }, 5);
    const offer = offerFrom(doc, pic(doc, 'r1p1'), 10);
    expect(offer.refusal).toBeNull();
    expect(offer.develop?.exposure).toBe(1);
    expect(offer.edit?.values).toEqual({ perspective: keystone });
    expect(offer.edit?.from).toEqual({ roll: 'r1', rollName: 'Roll r1', picture: 'r1p1', label: 'a.jpg', media: ref('a.jpg'), at: 10 });
    // The crop stays: the frame is the host's.
    expect(offer.stays).toEqual(['crop']);
    expect(carriedSections(offer.edit)).toEqual(['perspective']);
    expect(offerWords(offer)).toEqual({ takes: 'develop · perspective', leaves: 'crop' });
    expect(carriedWords(offer.edit)).toBe('perspective');
    expect(carriedPassSettings(offer.edit)).toMatchObject({ keystone, aspect: 'original', framing: null, layers: null });
  });

  it('carries no pass for a picture with only a develop — its origin still — and refuses a develop made on the sensor', () => {
    const plain = patchPicture(roll(), 'r1p1', { develop: { ...DEFAULT_DEVELOP, contrast: 20 } }, 5);
    const edit = offerFrom(plain, pic(plain, 'r1p1')).edit;
    expect(edit.from.picture).toBe('r1p1');
    expect(carriedDraws(edit)).toBe(false);
    expect(carriedKey(edit)).toBe('');
    expect(drawnEdit(edit, ref('a.jpg'))).toBeNull();
    expect(carriedOn(edit, ref('a.jpg'))).toBe(edit);
    const sensor = patchPicture(roll(), 'r1p1', { develop: { ...DEFAULT_DEVELOP, base: 'gain', rawGain: 1.2 } }, 5);
    expect(offerFrom(sensor, pic(sensor, 'r1p1')).refusal).toMatch(/sensor/);
  });

  it('lists the rolls that hold a picture with an edit, the latest first, each variant its own', () => {
    let older = patchPicture(roll('r1', 2), 'r1p1', { keystone }, 3);
    older = { ...older, updatedAt: 3 };
    let newer = patchPicture(roll('r2', 2), 'r2p1', { develop: { ...DEFAULT_DEVELOP, exposure: 1 } }, 9);
    newer = addVariant(newer, 'r2p1', 'clone', 'r2v', 9);
    const offers = offersFor([older, newer, roll('r3')], ref('A.JPG'));
    expect(offers.map((o) => o.picture.id)).toEqual(['r2p1', 'r2v', 'r1p1']);
    expect(carriedDraws(offers[1].edit)).toBe(false);
    expect(offersFor([older], ref('c.jpg'))).toEqual([]);
  });

  it('knows an update is waiting when the picture changed after it was carried', () => {
    let doc = journalRoll(roll(), patchPicture(roll(), 'r1p1', { keystone }, 5), 5);
    const offer = offerFrom(doc, pic(doc, 'r1p1'), 10);
    expect(carriedIsStale(offer.edit, doc, pic(doc, 'r1p1'))).toBe(false);
    doc = journalRoll(doc, patchPicture(doc, 'r1p1', { keystone: { ...keystone, vertical: 20 } }, 20), 20);
    expect(carriedIsStale(offer.edit, doc, pic(doc, 'r1p1'))).toBe(true);
  });

  it('is drawn only over the file it was made on, and found again on its roll', () => {
    const doc = patchPicture(roll(), 'r1p1', { keystone }, 5);
    const edit = offerFrom(doc, pic(doc, 'r1p1'), 10).edit;
    expect(drawnEdit(edit, ref('A.JPG'))).toBe(edit);
    expect(drawnEdit(edit, ref('b.jpg'))).toBeNull();
    expect(carriedOn(edit, null)).toBeNull();
    expect(carriedOn(null, ref('a.jpg'))).toBeNull();
    expect(carriedSource([roll('r2'), doc], edit)?.picture.id).toBe('r1p1');
    expect(carriedSource([roll('r2')], edit)).toBeNull();
  });

  it('asks the subject model only when a layer needs it, and keys on what it draws', () => {
    const base = createLayer('subject', 'L1');
    const flat = patchPicture(roll(), 'r1p1', { layers: [base] }, 5);
    expect(carriedNeedsRasters(offerFrom(flat, pic(flat, 'r1p1'), 10).edit)).toBe(false);
    // A subject that DRAWS — a point picked and an exposure on it — asks for its mask.
    const subject: AdjustLayer = {
      ...base,
      mask: { ...(base.mask as SubjectMask), points: [[0.5, 0.5]] },
      develop: { ...DEFAULT_DEVELOP, exposure: 1 },
    };
    const doc = patchPicture(roll(), 'r1p1', { layers: [subject] }, 5);
    const offer = offerFrom(doc, pic(doc, 'r1p1'), 10);
    expect(carriedNeedsRasters(offer.edit)).toBe(true);
    expect(carriedKey(offer.edit)).toContain('L1');
    expect(carriedKey(null)).toBe('');
  });

  it('reads a stored edit back, and refuses what is not one', () => {
    const doc = patchPicture(roll(), 'r1p1', { keystone }, 5);
    const edit = offerFrom(doc, pic(doc, 'r1p1'), 10).edit;
    expect(readCarriedEdit(JSON.parse(JSON.stringify(edit)))).toEqual(edit);
    expect(readCarriedEdit({ from: { roll: 'r' } })).toBeNull();
    expect(readCarriedEdit({ ...edit, from: { ...edit.from, media: undefined } })).toBeNull();
    // A crop never crosses: an origin with no pass is read as one.
    expect(carriedSections(readCarriedEdit({ from: { roll: 'r', picture: 'p', at: 1, media: ref('a.jpg') }, values: { crop: {} } }))).toEqual([]);
    expect(readCarriedEdit(null)).toBeNull();
  });
});
