import { ALL_META } from '../exif/meta-groups';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILM_TEXTURE } from '../film/film-texture';
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
  doc = patchPicture(
    doc,
    'p1',
    {
      develop: { ...DEFAULT_DEVELOP, highlights: -40 },
      aspect: '4:5',
      grade: {
        layers: [{ id: 'l1', source: 'custom', name: 'Mine', customText: 'LUT_3D_SIZE 2', intensity: 0.6, enabled: true }],
        output: 'rec709-to-srgb',
        film: { ...DEFAULT_FILM_TEXTURE, grain: 0.35, halation: 0.2 },
      },
    },
    3000,
  );
  return {
    ...doc,
    export: { targets: [{ name: '', size: { mode: 'long', value: 2048 }, quality: 0.85, sharpen: 'off', watermark: false }, { name: 'Web', size: { mode: 'short', value: 1080 }, quality: 0.8, sharpen: 'standard', watermark: true }], replace: true, hdr: true, hdrStops: 3, metadata: { ...ALL_META, position: false }, watermark: { text: '© {creator}', position: 'bottom-left', size: 3, opacity: 0.5, tone: 'dark' } },
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
    expect(Object.keys(file).sort()).toEqual(['export', 'exportedAt', 'kind', 'name', 'pictures', 'version']);
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
    // Each picture's look travels with it — under a fresh id (below).
    const withoutId = (pictures: RollDoc['pictures']) => pictures.map((p) => ({ ...p, id: '' }));
    expect(withoutId(imported.pictures)).toEqual(withoutId(original.pictures));
    expect(imported.pictures[0].id).not.toBe(original.pictures[0].id);
    expect(imported.pictures[0].grade?.output).toBe('rec709-to-srgb');
    expect(imported.export).toEqual(original.export);
  });

  it('gives every picture a fresh id, so one file imported twice is two rolls that share nothing', () => {
    const parsed = parseRollFile(serializeRollFile(toRollFile(sample(), 0)));
    if (!parsed.ok) throw new Error(parsed.error);
    let n = 0;
    const first = rollDocFromFile(parsed.file, 1, 'local', () => `a${++n}`);
    const second = rollDocFromFile(parsed.file, 2, 'local', () => `b${++n}`);
    expect(first.pictures.map((p) => p.id)).toEqual(['a1']);
    expect(second.pictures.map((p) => p.id)).toEqual(['b2']);
    expect(parsed.file.pictures[0].id).toBe('p1');
  });

  it('hands a pre-v5 file’s one look to every picture', () => {
    const parsed = parseRollFile(
      JSON.stringify({
        kind: ROLL_FILE_KIND,
        version: 4,
        name: 'Old',
        pictures: [{ id: 'a', ref: { name: 'a.jpg', size: 1 } }, { id: 'b', ref: { name: 'b.jpg', size: 1 } }],
        grade: { layers: [], output: 'rec709-to-srgb' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.pictures.map((p) => p.grade?.output)).toEqual(['rec709-to-srgb', 'rec709-to-srgb']);
    expect('grade' in parsed.file).toBe(false);
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
