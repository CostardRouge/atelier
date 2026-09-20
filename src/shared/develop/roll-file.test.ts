import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { addPictures, createRollDoc, patchPicture, ROLL_DOC_VERSION, type RollDoc } from './roll-types';
import {
  ROLL_FILE_KIND,
  parseRollFile,
  rollDocFromFile,
  rollFileName,
  serializeRollFile,
  toRollFile,
} from './roll-file';
import { fromWireDoc, toWireDoc } from './roll-remote';

function sample(): RollDoc {
  let n = 0;
  let doc = createRollDoc('Islande — jour 3', 'winnow.example', 1000, 'r1');
  doc = addPictures(doc, [{ name: 'a.dng', size: 5, lastModified: 1, hash: 'h1', assetId: 'winnow.example/7' }], 2000, () => `p${++n}`);
  doc = patchPicture(doc, 'p1', { develop: { ...DEFAULT_DEVELOP, highlights: -40 }, aspect: '4:5' }, 3000);
  return {
    ...doc,
    grade: { layers: [{ id: 'l1', source: 'custom', name: 'Mine', customText: 'LUT_3D_SIZE 2', intensity: 0.6, enabled: true }], output: 'rec709-to-srgb' },
    export: { longEdge: 2048, quality: 0.85, originals: 'originals', hdr: true, hdrStops: 3 },
  };
}

describe('the roll file', () => {
  it('names the file after the roll', () => {
    expect(rollFileName('Islande — jour 3')).toBe('islande-jour-3.roll.json');
    expect(rollFileName('   ')).toBe('roll.roll.json');
  });

  it('carries everything but the id, the source and the timestamps', () => {
    const file = toRollFile(sample(), 0);
    expect(file.kind).toBe(ROLL_FILE_KIND);
    expect(file.version).toBe(ROLL_DOC_VERSION);
    expect(Object.keys(file).sort()).toEqual(['export', 'exportedAt', 'grade', 'kind', 'name', 'pictures', 'version']);
    expect(file.pictures[0].ref.hash).toBe('h1');
  });

  it('comes back as a NEW roll on the importing source, holding exactly what was written', () => {
    const original = sample();
    const parsed = parseRollFile(serializeRollFile(toRollFile(original, 0)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const imported = rollDocFromFile(parsed.file, 9000, 'local');
    expect(imported.id).not.toBe(original.id);
    expect(imported).toMatchObject({ sourceId: 'local', createdAt: 9000, updatedAt: 9000, name: original.name });
    expect(imported.pictures).toEqual(original.pictures);
    expect(imported.grade).toEqual(original.grade);
    expect(imported.export).toEqual(original.export);
  });

  it('refuses what it cannot read, saying why', () => {
    expect(parseRollFile('{nope')).toEqual({ ok: false, error: 'That file is not valid JSON.' });
    expect(parseRollFile('[]').ok).toBe(false);
    expect(parseRollFile(JSON.stringify({ kind: 'atelier/road-trip', pictures: [] }))).toMatchObject({ ok: false });
    expect(parseRollFile(JSON.stringify({ kind: ROLL_FILE_KIND, version: ROLL_DOC_VERSION + 1, pictures: [] }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('newer version'),
    });
    expect(parseRollFile(JSON.stringify({ kind: ROLL_FILE_KIND, version: 1 }))).toMatchObject({ ok: false });
  });
});

describe('the roll on the wire', () => {
  it('leaves without its source and comes back stamped from the request', () => {
    const doc = sample();
    const wire = toWireDoc(doc);
    expect('sourceId' in wire).toBe(false);
    const back = fromWireDoc(JSON.parse(JSON.stringify(wire)), 'r1', 'winnow.example');
    expect(back).toEqual(doc);
    expect(fromWireDoc({ ...wire, id: 'forged' }, 'r1', 'other.host')).toMatchObject({ id: 'r1', sourceId: 'other.host' });
  });

  it('refuses a stored body that is not a roll', () => {
    expect(() => fromWireDoc({ name: 'a trip' }, 'r1', 'winnow.example')).toThrow(/not a roll/);
    expect(() => fromWireDoc('text', 'r1', 'winnow.example')).toThrow(/not a roll/);
  });
});
