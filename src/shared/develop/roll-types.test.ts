import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { DEFAULT_FRAMING } from '../media/framing';
import {
  DEFAULT_ROLL_EXPORT,
  ROLL_DOC_VERSION,
  addPictures,
  createRollDoc,
  migrateRollDoc,
  movePicture,
  copyBorderTo,
  copyCropTo,
  patchPicture,
  readRollDoc,
  readRollExport,
  readRollGrade,
  removePictures,
  rollProgress,
  sameMediaRef,
  type RollDoc,
} from './roll-types';

const ref = (name: string, extra: Record<string, unknown> = {}) => ({ name, size: 100, lastModified: 1, ...extra });
let n = 0;
const ids = () => `p${++n}`;

function roll(names: string[]): RollDoc {
  n = 0;
  return addPictures(createRollDoc('Iceland — day 3', 'local', 1000, 'r1'), names.map((x) => ref(x)), 2000, ids);
}

describe('createRollDoc', () => {
  it('starts empty, on its source, with the default export and no look', () => {
    const doc = createRollDoc('  Sony tests ', 'winnow.example', 5, 'r9');
    expect(doc).toEqual({
      id: 'r9',
      version: ROLL_DOC_VERSION,
      name: 'Sony tests',
      sourceId: 'winnow.example',
      createdAt: 5,
      updatedAt: 5,
      pictures: [],
      grade: null,
      export: { ...DEFAULT_ROLL_EXPORT },
    });
  });
});

describe('addPictures', () => {
  it('appends each picture once, in order, as shot and uncropped', () => {
    const doc = roll(['a.jpg', 'b.jpg']);
    expect(doc.pictures.map((p) => [p.id, p.ref.name, p.develop, p.framing, p.aspect])).toEqual([
      ['p1', 'a.jpg', null, null, 'original'],
      ['p2', 'b.jpg', null, null, 'original'],
    ]);
    expect(doc.updatedAt).toBe(2000);
  });

  it('never adds a picture already on the roll, however it is named', () => {
    const doc = addPictures(
      createRollDoc('x', 'local', 0, 'r'),
      [ref('A.JPG', { hash: 'h1' }), ref('renamed.jpg', { hash: 'h1' }), ref('a.jpg', { hash: 'h1' })],
      1,
      ids,
    );
    expect(doc.pictures).toHaveLength(1);
    const same = addPictures(doc, [ref('a.jpg', { hash: 'h1' })], 2, ids);
    expect(same).toBe(doc);
  });

  it('tells pictures apart by source id first, then by content, then by name and size', () => {
    expect(sameMediaRef(ref('a', { assetId: 'w/1' }), ref('b', { assetId: 'w/1' }))).toBe(true);
    expect(sameMediaRef(ref('a', { assetId: 'w/1' }), ref('a', { assetId: 'w/2' }))).toBe(false);
    expect(sameMediaRef(ref('a', { hash: 'h' }), ref('b', { hash: 'h' }))).toBe(true);
    expect(sameMediaRef(ref('IMG.JPG'), ref('img.jpg'))).toBe(true);
    expect(sameMediaRef(ref('img.jpg'), { ...ref('img.jpg'), size: 101 })).toBe(false);
  });
});

describe('editing the strip', () => {
  it('moves one picture, clamping the target', () => {
    const doc = roll(['a', 'b', 'c']);
    expect(movePicture(doc, 0, 2, 3).pictures.map((p) => p.ref.name)).toEqual(['b', 'c', 'a']);
    expect(movePicture(doc, 2, -5, 3).pictures.map((p) => p.ref.name)).toEqual(['c', 'a', 'b']);
    expect(movePicture(doc, 1, 1, 3)).toBe(doc);
    expect(movePicture(doc, 9, 0, 3)).toBe(doc);
  });

  it('removes pictures by id, and hands back the same roll when none match', () => {
    const doc = roll(['a', 'b', 'c']);
    expect(removePictures(doc, ['p1', 'p3'], 3).pictures.map((p) => p.id)).toEqual(['p2']);
    expect(removePictures(doc, ['nope'], 3)).toBe(doc);
  });

  it('patches one picture and never its id or ref', () => {
    const doc = roll(['a', 'b']);
    const lifted = { ...DEFAULT_DEVELOP, exposure: 0.5 };
    const next = patchPicture(doc, 'p2', { develop: lifted, aspect: '4:5' }, 9);
    expect(next.pictures[1]).toMatchObject({ id: 'p2', ref: { name: 'b' }, develop: lifted, aspect: '4:5' });
    expect(next.pictures[0]).toBe(doc.pictures[0]);
    expect(patchPicture(doc, 'nope', { aspect: '1:1' }, 9)).toBe(doc);
  });

  it('copies a crop onto other pictures, each its own copy, an untouched framing as null', () => {
    const doc = roll(['a', 'b', 'c']);
    const framing = { ...DEFAULT_FRAMING, scale: 1.5, rotation: 90, flipX: true, x: 0.2 };
    const next = copyCropTo(doc, ['p2', 'p3'], { aspect: '4:5', framing }, 9);
    expect(next.pictures[0]).toBe(doc.pictures[0]);
    expect(next.pictures[1]).toMatchObject({ aspect: '4:5', framing });
    expect(next.pictures[1].framing).not.toBe(next.pictures[2].framing);
    expect(next.pictures[1].framing).not.toBe(framing);
    expect(next.updatedAt).toBe(9);
    const plain = copyCropTo(next, ['p2'], { aspect: 'original', framing: { ...DEFAULT_FRAMING } }, 10);
    expect(plain.pictures[1]).toMatchObject({ aspect: 'original', framing: null });
    expect(copyCropTo(doc, ['nope'], { aspect: '1:1', framing: null }, 9)).toBe(doc);
  });

  it('copies a border onto other pictures and leaves their crops alone', () => {
    let doc = roll(['a', 'b', 'c']);
    doc = patchPicture(doc, 'p2', { aspect: '1:1', framing: { ...DEFAULT_FRAMING, scale: 2 } }, 5);
    const border = { aspect: '4:5', fill: 'blur', margin: { x: 0.1, y: 0.02 } };
    const next = copyBorderTo(doc, ['p2', 'p3'], border, 9);
    expect(next.pictures[0]).toBe(doc.pictures[0]);
    expect(next.pictures[1]).toMatchObject({ aspect: '1:1', framing: { scale: 2 }, border });
    expect(next.pictures[1].border).not.toBe(border);
    expect(next.pictures[1].border!.margin).not.toBe(next.pictures[2].border!.margin);
    // Taking it off, and a copy that changes nothing, which returns the roll itself.
    expect(copyBorderTo(next, ['p2'], null, 10).pictures[1].border).toBeNull();
    expect(copyBorderTo(next, ['p2', 'p3'], { ...border, margin: { ...border.margin } }, 11)).toBe(next);
  });

  it('reads a border, and a v1 Whole framing that is exactly one as one', () => {
    const raw = {
      id: 'r',
      pictures: [
        { id: 'a', ref: ref('a'), aspect: '4:5', framing: { ...DEFAULT_FRAMING, fit: 'contain' } },
        { id: 'b', ref: ref('b'), aspect: '4:5', framing: { ...DEFAULT_FRAMING, fit: 'contain', rotation: 90 } },
        { id: 'c', ref: ref('c'), border: { aspect: null, fill: '#ffffff', margin: { x: 0.1, y: 0.1 } } },
      ],
    };
    const doc = readRollDoc(raw)!;
    expect(doc.version).toBe(3);
    expect(doc.pictures[0]).toMatchObject({
      aspect: 'original',
      framing: null,
      border: { aspect: '4:5', fill: '#000000', margin: { x: 0, y: 0 } },
    });
    // A quarter-turned Whole is not a border without the picture's size: it stays contain.
    expect(doc.pictures[1]).toMatchObject({ aspect: '4:5', framing: { fit: 'contain', rotation: 90 }, border: null });
    expect(doc.pictures[2].border).toEqual({ aspect: null, fill: '#ffffff', margin: { x: 0.1, y: 0.1 } });
    // Reading it again changes nothing.
    expect(readRollDoc(doc)).toEqual({ ...doc, updatedAt: doc.updatedAt, createdAt: doc.createdAt });
  });

  it('counts a picture as developed when it has a develop or a crop', () => {
    let doc = roll(['a', 'b', 'c', 'd']);
    doc = patchPicture(doc, 'p1', { develop: { ...DEFAULT_DEVELOP, contrast: 10 } });
    doc = patchPicture(doc, 'p3', { framing: { ...DEFAULT_FRAMING, scale: 1.4 } });
    // A shape alone is a crop: a free zone drawn with the corners pans nothing.
    doc = patchPicture(doc, 'p4', { aspect: 'free:1.5' });
    expect(rollProgress(doc)).toEqual({ total: 4, developed: 3 });
  });
});

describe('reading a stored roll', () => {
  it('refuses what is not a roll', () => {
    expect(readRollDoc(null)).toBeNull();
    expect(readRollDoc({ id: 'r', pictures: 'many' })).toBeNull();
    expect(readRollDoc({ pictures: [] })).toBeNull();
  });

  it('drops pictures that name nothing and repeats of one id, and normalises the rest', () => {
    const doc = readRollDoc(
      {
        id: 'r',
        name: 'Stored',
        sourceId: 'winnow.example',
        pictures: [
          { id: 'p1', ref: ref('a.jpg'), develop: { exposure: 0 }, framing: { ...DEFAULT_FRAMING }, aspect: 'wide' },
          { id: 'p1', ref: ref('b.jpg') },
          { id: 'p2', ref: { size: 3 } },
          { id: 'p3', ref: ref('c.jpg', { hash: 'h', junk: true }), develop: { exposure: 1 }, framing: { scale: 2 }, aspect: '4:5' },
        ],
        grade: { layers: [], output: 'none' },
        export: { longEdge: 99999, quality: 3, originals: 'maybe' },
        future: 'ignored',
      },
      'local',
    )!;
    expect(doc.pictures.map((p) => p.id)).toEqual(['p1', 'p3']);
    // An as-shot develop and an untouched framing are stored as nothing — one spelling each.
    expect(doc.pictures[0]).toMatchObject({ develop: null, framing: null, aspect: 'original' });
    expect(doc.pictures[1].ref).toEqual({ name: 'c.jpg', size: 100, lastModified: 1, hash: 'h' });
    expect(doc.pictures[1].develop?.exposure).toBe(1);
    expect(doc.pictures[1].framing?.scale).toBe(2);
    expect(doc.grade).toBeNull();
    expect(doc.export).toEqual({ longEdge: 16384, quality: 1, originals: 'auto', replace: false, hdr: false, hdrStops: 2 });
    expect(doc.sourceId).toBe('winnow.example');
    expect('future' in doc).toBe(false);
  });

  it('keeps a look with layers or a transform, and reads its layers safely', () => {
    // Strength is capped where every other reader caps it (3, over-applied), never at 1.
    expect(readRollGrade({ layers: [{ id: 'l', source: 'builtin:x', intensity: 7 }], output: 'bogus' })).toEqual({
      layers: [{ id: 'l', source: 'builtin:x', name: 'l', customText: null, intensity: 3, enabled: true }],
      output: 'none',
      film: null,
    });
    expect(readRollGrade({ layers: [{ id: 'l', source: 'builtin:x', intensity: 1.5 }], output: 'none' })?.layers[0].intensity).toBe(1.5);
    expect(readRollGrade({ layers: [{ nope: 1 }], output: 'rec709-to-srgb' })).toEqual({ layers: [], output: 'rec709-to-srgb', film: null });
    // A TEXTURE alone is a look: grain with no LUT is what a stock's texture half is for.
    const grainy = readRollGrade({ layers: [], output: 'none', film: { grain: 0.5 } });
    expect(grainy?.film?.grain).toBe(0.5);
    expect(readRollGrade({ layers: [], output: 'none', film: 'nope' })).toBeNull();
  });

  it('reads the export through its limits, and the source size as null', () => {
    expect(readRollExport({ longEdge: 1920.4, quality: 0.8, originals: 'proxies', replace: true })).toEqual({
      longEdge: 1920,
      quality: 0.8,
      originals: 'proxies',
      replace: true,
      hdr: false,
      hdrStops: 2,
    });
    // The HDR delivery: off unless said, its reach clamped to the stops a RAW keeps.
    expect(readRollExport({ hdr: true, hdrStops: 9.6 })).toMatchObject({ hdr: true, hdrStops: 4 });
    expect(readRollExport({ hdr: 'yes', hdrStops: 0 })).toMatchObject({ hdr: false, hdrStops: 1 });
    expect(readRollExport({ longEdge: null })).toEqual({ ...DEFAULT_ROLL_EXPORT });
    expect(readRollExport('junk')).toEqual({ ...DEFAULT_ROLL_EXPORT });
    // A roll written before the choice existed keeps what is in its folder.
    expect(readRollExport({ quality: 0.9 }).replace).toBe(false);
    expect(readRollExport({ replace: 'yes' }).replace).toBe(false);
  });

  it('reads the rendition a picture is developed from, and nothing as null', () => {
    const doc = readRollDoc({
      id: 'r',
      pictures: [
        { id: 'p1', ref: ref('a.jpg'), rendition: 'delivered:dji_0101.jpg' },
        { id: 'p2', ref: ref('b.jpg'), rendition: '' },
        { id: 'p3', ref: ref('c.jpg') },
      ],
    })!;
    expect(doc.pictures.map((p) => p.rendition)).toEqual(['delivered:dji_0101.jpg', null, null]);
    expect(patchPicture(doc, 'p3', { rendition: 'proxy' }).pictures[2].rendition).toBe('proxy');
  });

  it('migrates a stored roll onto the current shape without changing what it holds', () => {
    const doc = patchPicture(roll(['a', 'b']), 'p1', { develop: { ...DEFAULT_DEVELOP, blacks: -8 } }, 3000);
    expect(migrateRollDoc(doc)).toEqual(doc);
  });
});
