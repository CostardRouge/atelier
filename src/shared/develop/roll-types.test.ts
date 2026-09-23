import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { DEFAULT_FRAMING } from '../media/framing';
import { DEFAULT_KEYSTONE } from '../render/geometry';
import { DEFAULT_LENS } from '../render/lens';
import { DEFAULT_DETAIL } from '../render/detail';
import { createLayer } from './layer';
import {
  DEFAULT_ROLL_EXPORT,
  ROLL_DOC_VERSION,
  addPictures,
  createRollDoc,
  migrateRollDoc,
  movePicture,
  copyBorderTo,
  copyCropTo,
  copyGradeTo,
  delivers,
  isEdited,
  isIgnored,
  matchesDeliveryFilter,
  patchPicture,
  setDelivery,
  setPictureWords,
  toggledDelivery,
  pictureEdits,
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
      export: { ...DEFAULT_ROLL_EXPORT },
    });
  });
});

describe('copyGradeTo', () => {
  const look = { layers: [], output: 'rec709-to-srgb' as const, film: null };
  it('writes one look onto the pictures named, each as its own copy, and nothing else', () => {
    const doc = patchPicture(roll(['a.jpg', 'b.jpg', 'c.jpg']), 'p1', { develop: { ...DEFAULT_DEVELOP, exposure: 1 } }, 3000);
    const next = copyGradeTo(doc, ['p1', 'p2'], look, 4000);
    expect(next.pictures.map((p) => p.grade?.output ?? null)).toEqual(['rec709-to-srgb', 'rec709-to-srgb', null]);
    expect(next.pictures[0].grade).not.toBe(look);
    expect(next.pictures[0].develop?.exposure).toBe(1);
    expect(next.updatedAt).toBe(4000);
  });

  it('takes a look off with null, and returns the same roll when nothing changes', () => {
    const dressed = copyGradeTo(roll(['a.jpg', 'b.jpg']), ['p1', 'p2'], look, 3000);
    expect(copyGradeTo(dressed, ['p1'], { ...look }, 5000)).toBe(dressed);
    expect(copyGradeTo(dressed, ['p1'], null, 5000).pictures.map((p) => p.grade ?? null)).toEqual([null, look]);
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
    expect(doc.version).toBe(ROLL_DOC_VERSION);
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

  it('counts a picture as developed when it has a develop, a look or a crop', () => {
    let doc = roll(['a', 'b', 'c', 'd', 'e']);
    doc = patchPicture(doc, 'p5', { grade: { layers: [], output: 'rec709-to-srgb', film: null } });
    doc = patchPicture(doc, 'p1', { develop: { ...DEFAULT_DEVELOP, contrast: 10 } });
    doc = patchPicture(doc, 'p3', { framing: { ...DEFAULT_FRAMING, scale: 1.4 } });
    // A shape alone is a crop: a free zone drawn with the corners pans nothing.
    doc = patchPicture(doc, 'p4', { aspect: 'free:1.5' });
    expect(rollProgress(doc)).toEqual({ total: 5, developed: 4, ignored: 0 });
    // An ignored picture is out of both numbers, and counted apart.
    expect(rollProgress(setDelivery(doc, ['p1', 'p2'], 'ignore'))).toEqual({ total: 3, developed: 3, ignored: 2 });
  });
});

describe('pictureEdits — the one answer to “is it edited?”', () => {
  it('names every kind of edit, and nothing on a picture as it came', () => {
    const doc = roll(['a']);
    const bare = doc.pictures[0];
    expect(pictureEdits(bare)).toEqual([]);
    expect(isEdited(bare)).toBe(false);
    const all = {
      ...bare,
      develop: { ...DEFAULT_DEVELOP, exposure: 1 },
      grade: { layers: [], output: 'rec709-to-srgb' as const, film: null },
      aspect: '4:5',
      border: { aspect: null, fill: '#ffffff', margin: { x: 0.1, y: 0.1 } },
      keystone: { ...DEFAULT_KEYSTONE, vertical: 20 },
      lens: { ...DEFAULT_LENS, distortion: 10 },
      detail: { ...DEFAULT_DETAIL, sharpen: 40 },
      repair: [{ id: 'h1', kind: 'heal' as const, x: 0.5, y: 0.5, radius: 0.02, feather: 0.5, dx: 0.05, dy: 0 }],
      layers: [createLayer('radial', 'l1')],
    };
    expect(pictureEdits(all as RollDoc['pictures'][number])).toEqual([
      'develop', 'look', 'crop', 'border', 'perspective', 'lens', 'detail', 'repair', 'layers',
    ]);
  });

  it('does not count a value dragged back to its default, nor which file the picture is developed from', () => {
    const bare = roll(['a']).pictures[0];
    expect(
      isEdited({
        ...bare,
        develop: { ...DEFAULT_DEVELOP },
        framing: { ...DEFAULT_FRAMING },
        keystone: { ...DEFAULT_KEYSTONE },
        lens: { ...DEFAULT_LENS },
        detail: { ...DEFAULT_DETAIL },
        rendition: 'delivered:a.JPG',
      }),
    ).toBe(false);
  });
});

describe('delivery — which pictures leave', () => {
  const edited = () => patchPicture(roll(['a', 'b']), 'p1', { develop: { ...DEFAULT_DEVELOP, exposure: 1 } });

  it('leaves when edited by default, and the author’s call wins', () => {
    const doc = edited();
    expect(doc.pictures.map(delivers)).toEqual([true, false]);
    const flipped = setDelivery(setDelivery(doc, ['p1'], 'no'), ['p2'], 'yes');
    expect(flipped.pictures.map(delivers)).toEqual([false, true]);
    const gone = setDelivery(doc, ['p1'], 'ignore');
    expect(delivers(gone.pictures[0])).toBe(false);
    expect(isIgnored(gone.pictures[0])).toBe(true);
  });

  it('toggles to the other answer, stored as auto when the rule already says it', () => {
    const [ed, bare] = edited().pictures;
    // Edited → hold (pinned); held edited → back to the rule.
    expect(toggledDelivery(ed)).toBe('no');
    expect(toggledDelivery({ ...ed, deliver: 'no' })).toBe('auto');
    // Bare → send (pinned); sent bare → back to the rule.
    expect(toggledDelivery(bare)).toBe('yes');
    expect(toggledDelivery({ ...bare, deliver: 'yes' })).toBe('auto');
    // Ignored → back into the work on the rule.
    expect(toggledDelivery({ ...ed, deliver: 'ignore' })).toBe('auto');
  });

  it('filters the table, leaving an ignored picture to its own group', () => {
    const doc = setDelivery(setDelivery(roll(['a', 'b', 'c']), ['p2'], 'yes'), ['p3'], 'ignore');
    const withEdit = patchPicture(doc, 'p1', { develop: { ...DEFAULT_DEVELOP, exposure: 1 } });
    const ids = (f: Parameters<typeof matchesDeliveryFilter>[1]) =>
      withEdit.pictures.filter((p) => matchesDeliveryFilter(p, f)).map((p) => p.id);
    expect(ids('all')).toEqual(['p1', 'p2']);
    expect(ids('edited')).toEqual(['p1']);
    expect(ids('leaving')).toEqual(['p1', 'p2']);
    expect(ids('held')).toEqual([]);
  });

  it('writes a state onto several pictures, the same roll when nothing changes', () => {
    const doc = roll(['a', 'b']);
    expect(setDelivery(doc, ['p1'], 'auto')).toBe(doc);
    expect(setDelivery(doc, ['p1', 'p2'], 'ignore', 9).pictures.map((p) => p.deliver)).toEqual(['ignore', 'ignore']);
  });

  it('reads an absent or unknown state as auto, and is never an edit', () => {
    const doc = readRollDoc({ id: 'r', pictures: [{ id: 'a', ref: ref('a.jpg') }, { id: 'b', ref: ref('b.jpg'), deliver: 'maybe' }, { id: 'c', ref: ref('c.jpg'), deliver: 'ignore' }] })!;
    expect(doc.pictures.map((p) => p.deliver)).toEqual(['auto', 'auto', 'ignore']);
    expect(isEdited(doc.pictures[2])).toBe(false);
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
    expect(doc.pictures.map((p) => p.grade)).toEqual([null, null]);
    // `originals`, written by v1–v3, is left behind: which pixels is the picture's own (v4).
    // v5's one long edge and quality become the one target (v6), through their limits.
    expect(doc.export).toEqual({
      targets: [{ name: '', size: { mode: 'long', value: 16384 }, quality: 1, sharpen: 'off' }],
      replace: false,
      hdr: false,
      hdrStops: 2,
      metadata: DEFAULT_ROLL_EXPORT.metadata,
    });
    expect(doc.sourceId).toBe('winnow.example');
    expect('future' in doc).toBe(false);
  });

  it('hands a pre-v5 roll’s one look to every picture, and never a v5 roll’s stray key', () => {
    const look = { layers: [{ id: 'l', source: 'builtin:x', intensity: 0.5 }], output: 'rec709-to-srgb' };
    const old = readRollDoc({
      id: 'r',
      version: 4,
      pictures: [{ id: 'a', ref: ref('a.jpg') }, { id: 'b', ref: ref('b.jpg') }],
      grade: look,
    })!;
    expect(old.version).toBe(ROLL_DOC_VERSION);
    expect(old.pictures.map((p) => p.grade?.layers[0]?.source)).toEqual(['builtin:x', 'builtin:x']);
    // Each its own copy: dressing one never dresses the other.
    expect(old.pictures[0].grade).not.toBe(old.pictures[1].grade);
    expect('grade' in old).toBe(false);
    // Idempotent: reading the migrated roll again changes nothing.
    expect(readRollDoc(JSON.parse(JSON.stringify(old)))).toEqual({ ...old, updatedAt: old.updatedAt, createdAt: old.createdAt });

    const bare = readRollDoc({
      id: 'r',
      version: 5,
      pictures: [{ id: 'a', ref: ref('a.jpg'), grade: null }, { id: 'b', ref: ref('b.jpg'), grade: look }],
      grade: look,
    })!;
    expect(bare.pictures.map((p) => p.grade?.output ?? null)).toEqual([null, 'rec709-to-srgb']);
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
      targets: [{ name: '', size: { mode: 'long', value: 1920 }, quality: 0.8, sharpen: 'off' }],
      replace: true,
      hdr: false,
      hdrStops: 2,
      metadata: DEFAULT_ROLL_EXPORT.metadata,
    });
    // The HDR delivery: off unless said, its reach clamped to the stops a RAW keeps.
    expect(readRollExport({ hdr: true, hdrStops: 9.6 })).toMatchObject({ hdr: true, hdrStops: 4 });
    expect(readRollExport({ hdr: 'yes', hdrStops: 0 })).toMatchObject({ hdr: false, hdrStops: 1 });
    expect(readRollExport({ longEdge: null })).toEqual({ ...DEFAULT_ROLL_EXPORT });
    expect(readRollExport('junk')).toEqual({ ...DEFAULT_ROLL_EXPORT });
    // M3: what leaves is read group by group, a roll written before it as All.
    expect(readRollExport({ metadata: { position: false } }).metadata).toEqual({ ...DEFAULT_ROLL_EXPORT.metadata, position: false });
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

describe('a picture’s words (M2)', () => {
  it('are the picture’s own, trimmed, an emptied one taken off', () => {
    const doc = roll(['a.jpg', 'b.jpg']);
    const [a, b] = doc.pictures;
    const titled = setPictureWords(doc, a.id, { title: '  Pinnacles  ', caption: 'At dawn, Nambung.' }, 5);
    expect(titled.pictures[0]).toMatchObject({ title: 'Pinnacles', caption: 'At dawn, Nambung.' });
    expect(titled.pictures[1]).toBe(doc.pictures[1]);
    expect(titled.updatedAt).toBe(5);
    // Nothing changed: the same roll, so a blur is no undo step.
    expect(setPictureWords(titled, a.id, { title: 'Pinnacles' })).toBe(titled);
    const cleared = setPictureWords(titled, a.id, { caption: '  ' });
    expect(cleared.pictures[0].title).toBe('Pinnacles');
    expect('caption' in cleared.pictures[0]).toBe(false);
    expect(setPictureWords(doc, 'nope', { title: 'x' })).toBe(doc);
    void b;
  });

  it('survive a round trip, and a roll written before them reads with none', () => {
    const doc = setPictureWords(roll(['a.jpg']), 'p' + String(n), { title: 'T', caption: 'C' });
    const back = readRollDoc(JSON.parse(JSON.stringify(doc)))!;
    const p = back.pictures[back.pictures.length - 1];
    expect([p.title, p.caption]).toEqual(['T', 'C']);
    const old = readRollDoc(JSON.parse(JSON.stringify(roll(['b.jpg']))))!;
    expect('title' in old.pictures[0] || 'caption' in old.pictures[0]).toBe(false);
  });
});
