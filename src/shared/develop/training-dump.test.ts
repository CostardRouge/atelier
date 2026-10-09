import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { createLayer } from './layer';
import { createRollDoc, createRollPicture, type RollDoc } from './roll-types';
import type { ShotRecord } from './shot-record';
import {
  TRAINING_FILE_KIND,
  TRAINING_FILE_VERSION,
  buildTrainingDump,
  serializeTrainingFile,
  trainingFileName,
  trainingPair,
  trainingRecord,
} from './training-dump';

const stats = { bins: new Array(64).fill(1), total: 64, linearMean: [0.2, 0.3, 0.4] as [number, number, number], counted: 60 };

function shotOf(id: string, rollId: string): ShotRecord {
  return {
    id,
    rollId,
    vignette: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
    aspect: 1.5,
    natural: { width: 6000, height: 4000 },
    stats,
    exif: { model: 'ILCE-7CM2', iso: 400 },
    viaRawPreview: false,
    updatedAt: 1,
  };
}

function rollWith(...pictures: ReturnType<typeof createRollPicture>[]): RollDoc {
  const roll = createRollDoc('Islande', undefined, 1000);
  return { ...roll, pictures };
}

describe('trainingRecord', () => {
  it('fills every default of an untouched picture, so a script never guesses', () => {
    const p = createRollPicture({ name: 'a.jpg', size: 10, lastModified: 1 }, 'p1');
    const rec = trainingRecord(p);
    expect(rec.develop).toEqual({ ...DEFAULT_DEVELOP });
    expect(rec.crop.aspect).toBe('original');
    expect(rec.crop.framing).toMatchObject({ scale: 1, x: 0, y: 0, rotation: 0 });
    expect(rec.keystone).toBeNull();
    expect(rec.lens).toBeNull();
    expect(rec.detail).toBeNull();
    expect(rec.repair).toEqual([]);
    expect(rec.layers).toEqual([]);
    expect(rec.look).toBeNull();
  });

  it('keeps the author’s record read as a roll reads it, and the look without its lattice', () => {
    const p = createRollPicture({ name: 'a.jpg', size: 10, lastModified: 1 }, 'p1');
    p.develop = { ...DEFAULT_DEVELOP, exposure: 0.7, highlights: -40 };
    p.keystone = { vertical: 12, horizontal: 0, rotation: 0, aspect: 0, scale: 1.1 };
    p.layers = [createLayer('radial', 'l1')];
    const cube = `TITLE "x"\nLUT_3D_SIZE 2\n${'0 0 0\n'.repeat(2000)}`;
    p.grade = {
      layers: [
        { id: 'a', source: 'custom', name: 'old.cube', customText: cube, intensity: 1, enabled: true },
        { id: 'b', source: 'film', name: 'Classic', customText: '{"stock":"classic"}', intensity: 0.8, enabled: true },
      ],
      output: 'none',
    };
    const rec = trainingRecord(p);
    expect(rec.develop.exposure).toBe(0.7);
    expect(rec.develop.highlights).toBe(-40);
    expect(rec.develop.vibrance).toBe(0);
    expect(rec.keystone).toEqual({ vertical: 12, horizontal: 0, rotation: 0, aspect: 0, scale: 1.1 });
    expect(rec.layers).toHaveLength(1);
    expect(rec.layers[0].mask?.kind).toBe('radial');
    expect(rec.look?.layers[0]).toEqual({ source: 'custom', name: 'old.cube', intensity: 1, enabled: true, settings: null, inlinedCubeBytes: cube.length });
    expect(rec.look?.layers[1].settings).toBe('{"stock":"classic"}');
  });
});

describe('buildTrainingDump', () => {
  it('pairs every picture that has its shot, in roll order, and counts the rest', async () => {
    const a = createRollPicture({ name: 'a.jpg', size: 10, lastModified: 1, hash: 'h-a' }, 'p1');
    const b = createRollPicture({ name: 'b.jpg', size: 20, lastModified: 1 }, 'p2');
    const clip = createRollPicture({ name: 'c.mp4', size: 30, lastModified: 1 }, 'p3');
    const roll = rollWith(a, b, clip);
    const shots = new Map([
      ['p1', shotOf('p1', roll.id)],
      ['p2', shotOf('p2', roll.id)],
    ]);
    const dump = await buildTrainingDump([roll], shots, async (blob) => `data:${blob.type};base64,${blob.size}`, 1_700_000_000_000);
    expect(dump.unpaired).toBe(1);
    expect(dump.file.kind).toBe(TRAINING_FILE_KIND);
    expect(dump.file.version).toBe(TRAINING_FILE_VERSION);
    expect(dump.file.exportedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(dump.file.pairs.map((p) => p.picture.id)).toEqual(['p1', 'p2']);
    expect(dump.file.pairs[0]).toMatchObject({
      roll: { name: 'Islande' },
      picture: { name: 'a.jpg', size: 10, hash: 'h-a', variant: null },
      edits: [],
      agent: false,
      shot: { vignette: 'data:image/jpeg;base64,10', aspect: 1.5, natural: { width: 6000, height: 4000 }, exif: { model: 'ILCE-7CM2', iso: 400 } },
    });
    expect(dump.file.pairs[1].picture.hash).toBeNull();
  });

  it('keeps a pair whose vignette cannot be read, since the stats and the record still are one', async () => {
    const a = createRollPicture({ name: 'a.jpg', size: 10, lastModified: 1 }, 'p1');
    a.develop = { ...DEFAULT_DEVELOP, exposure: 1 };
    const roll = rollWith(a);
    const dump = await buildTrainingDump([roll], new Map([['p1', shotOf('p1', roll.id)]]), async () => {
      throw new Error('no reader');
    });
    expect(dump.file.pairs[0].shot.vignette).toBeNull();
    expect(dump.file.pairs[0].edits).toEqual(['develop']);
    expect(dump.file.pairs[0].record.develop.exposure).toBe(1);
  });

  it('marks a record an agent wrote a step of, so a trainer can leave it out', () => {
    const p = createRollPicture({ name: 'a.jpg', size: 10, lastModified: 1 }, 'p1');
    p.develop = { ...DEFAULT_DEVELOP, exposure: 0.4 };
    p.journal = [{ at: 1, sections: ['develop'], after: { develop: p.develop }, via: 'agent' }];
    const roll = rollWith(p);
    expect(trainingPair(roll, p, shotOf('p1', roll.id), null).agent).toBe(true);
    p.journal = [{ at: 1, sections: ['develop'], after: { develop: p.develop } }];
    expect(trainingPair(roll, p, shotOf('p1', roll.id), null).agent).toBe(false);
  });

  it('writes what the shot said about the source and nothing of the media’s ids', () => {
    const p = createRollPicture({ name: 'a.jpg', size: 10, lastModified: 1, assetId: '42' }, 'p1');
    const roll = rollWith(p);
    const pair = trainingPair(roll, p, shotOf('p1', roll.id), null);
    expect(JSON.stringify(pair)).not.toContain('"assetId"');
    expect(JSON.stringify(pair)).not.toContain('"42"');
  });
});

describe('the file', () => {
  it('serialises indented with a trailing newline, and names itself by the day', () => {
    const text = serializeTrainingFile({ kind: TRAINING_FILE_KIND, version: TRAINING_FILE_VERSION, exportedAt: 'x', pairs: [] });
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n "pairs": []');
    expect(trainingFileName(1_700_000_000_000)).toBe('atelier-training-2023-11-14.json');
  });
});
