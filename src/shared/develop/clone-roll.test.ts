import { describe, expect, it } from 'vitest';
import { cloneRoll } from './clone-roll';
import { addPictures, createRollDoc, type RollDoc } from './roll-types';
import { DEFAULT_DEVELOP } from './develop';

function sample(): RollDoc {
  let roll = createRollDoc('Désert', 'winnow.example', 1);
  roll = addPictures(roll, [
    { name: 'DJI_0001.JPG', size: 10, lastModified: 1, hash: 'aaa' },
    { name: 'DJI_0002.JPG', size: 20, lastModified: 2, hash: 'bbb' },
    { name: 'DJI_0003.MP4', size: 30, lastModified: 3, hash: 'ccc' },
  ]);
  roll.updatedAt = 2;
  roll.pictures[0] = { ...roll.pictures[0], develop: { ...DEFAULT_DEVELOP, exposure: 0.7 }, deliver: 'yes' };
  roll.pictures[1] = {
    ...roll.pictures[1],
    journal: [{ at: 5, tool: 'adjust', via: 'hand' } as unknown as NonNullable<RollDoc['pictures'][number]['journal']>[number]],
  };
  roll.export = { ...roll.export, replace: true };
  roll.opensOn = 'sensor' as RollDoc['opensOn'];
  return roll;
}

describe('cloneRoll', () => {
  it('is a new document: fresh id and timestamps, the target source, the chosen name', () => {
    const roll = sample();
    const { doc } = cloneRoll(roll, { name: '  Désert (2) ', sourceId: 'local', now: 99 });
    expect(doc.id).not.toBe(roll.id);
    expect(doc.name).toBe('Désert (2)');
    expect(doc.sourceId).toBe('local');
    expect(doc.createdAt).toBe(99);
    expect(doc.updatedAt).toBe(99);
  });

  it('keeps every picture with its develop, journal, delivery and refs', () => {
    const roll = sample();
    const { doc } = cloneRoll(roll, { name: 'x', sourceId: 'local' });
    expect(doc.pictures).toHaveLength(3);
    roll.pictures.forEach((picture, i) => {
      const { id: oldId, ...rest } = picture;
      const { id: newId, ...clone } = doc.pictures[i];
      expect(newId, 'picture id').not.toBe(oldId);
      expect(clone).toEqual(rest);
    });
  });

  it('carries the export settings and the file every picture opens on', () => {
    const roll = sample();
    const { doc } = cloneRoll(roll, { name: 'x', sourceId: 'local' });
    expect(doc.export).toEqual(roll.export);
    expect(doc.opensOn).toBe('sensor');
  });

  it('maps every old picture id to its new one, in order, with no id shared', () => {
    const roll = sample();
    const { doc, pictureIds } = cloneRoll(roll, { name: 'x', sourceId: 'local' });
    expect(pictureIds.size).toBe(3);
    roll.pictures.forEach((picture, i) => expect(pictureIds.get(picture.id)).toBe(doc.pictures[i].id));
    expect(new Set(doc.pictures.map((p) => p.id)).size).toBe(3);
    const old = new Set(roll.pictures.map((p) => p.id));
    expect(doc.pictures.some((p) => old.has(p.id))).toBe(false);
  });

  it('shares nothing mutable with the original', () => {
    const roll = sample();
    const { doc } = cloneRoll(roll, { name: 'x', sourceId: 'local' });
    doc.pictures[0].develop!.exposure = -1;
    doc.pictures.pop();
    doc.export.replace = false;
    expect(roll.pictures[0].develop!.exposure).toBe(0.7);
    expect(roll.pictures).toHaveLength(3);
    expect(roll.export.replace).toBe(true);
  });

  it('clones an empty roll', () => {
    const empty = createRollDoc('Vide', 'local', 1);
    const { doc, pictureIds } = cloneRoll(empty, { name: 'Vide (2)', sourceId: 'local' });
    expect(doc.pictures).toEqual([]);
    expect(pictureIds.size).toBe(0);
  });
});
