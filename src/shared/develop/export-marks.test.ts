import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { addPictures, createRollDoc, patchPicture, setDelivery, setPictureWords } from './roll-types';
import { exportKey, exportState, needsExport, pruneMarks, readExportMarks, withExported } from './export-marks';

let n = 0;
const roll = () =>
  addPictures(
    createRollDoc('R', 'local', 1, 'r1'),
    [{ name: 'a.jpg', size: 1, lastModified: 1 }, { name: 'b.jpg', size: 1, lastModified: 1 }],
    2,
    () => `p${++n}`,
  );

describe('export marks (E4)', () => {
  it('reads a picture as new, current after it leaves, changed after an edit', () => {
    const doc = roll();
    const [a, b] = doc.pictures;
    expect(exportState(a, {})).toBe('new');
    const marks = withExported({}, [a], 100);
    expect(marks[a.id]).toEqual({ at: 100, key: exportKey(a) });
    expect(exportState(a, marks)).toBe('current');
    expect(needsExport(b, marks)).toBe(true);
    const edited = patchPicture(doc, a.id, { develop: { ...DEFAULT_DEVELOP, exposure: 0.5 } }).pictures[0];
    expect(exportState(edited, marks)).toBe('changed');
    const titled = setPictureWords(doc, a.id, { title: 'Pinnacles' }).pictures[0];
    expect(exportState(titled, marks)).toBe('changed');
  });

  it('ignores what does not change the file: the delivery state, key order, empty spellings', () => {
    const doc = roll();
    const a = doc.pictures[0];
    const marks = withExported({}, [a], 1);
    expect(exportState(setDelivery(doc, [a.id], 'yes', 2).pictures[0], marks)).toBe('current');
    expect(exportKey({ ...a, repair: [], layers: undefined, lens: null })).toBe(exportKey({ ...a, repair: undefined, layers: [] }));
    const dev = { ...DEFAULT_DEVELOP, exposure: 1 };
    const reordered = Object.fromEntries(Object.entries(dev).reverse()) as typeof dev;
    expect(exportKey({ ...a, develop: dev })).toBe(exportKey({ ...a, develop: reordered }));
    expect(exportKey({ ...a, aspect: 'original' })).toBe(exportKey({ ...a, aspect: 'original', framing: null }));
    expect(exportKey({ ...a, aspect: '4:5' })).not.toBe(exportKey(a));
  });

  it('reads stored marks defensively and drops a removed picture’s', () => {
    expect(readExportMarks({ p: { at: 1, key: 'k' }, q: { at: 'x', key: 'k' }, r: null })).toEqual({ p: { at: 1, key: 'k' } });
    expect(readExportMarks('junk')).toEqual({});
    const marks = { p: { at: 1, key: 'k' }, q: { at: 2, key: 'k' } };
    expect(pruneMarks(marks, ['p'])).toEqual({ p: { at: 1, key: 'k' } });
    expect(pruneMarks(marks, ['p', 'q'])).toBe(marks);
  });
});
