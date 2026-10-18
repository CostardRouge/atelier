import { describe, expect, it } from 'vitest';
import { fitWireDoc } from './roll-remote';
import { addPictures, createRollDoc, type JournalStep, type RollDoc } from './roll-types';

function heavyRoll(pictures: number, steps: number): RollDoc {
  const base = addPictures(
    createRollDoc('R', 'winnow', 1, 'r'),
    Array.from({ length: pictures }, (_, i) => ({ name: `p${i}.jpg`, size: 1, lastModified: 1 })),
    2,
  );
  const journal: JournalStep[] = Array.from({ length: steps }, (_, i) => ({
    at: i * 10_000,
    sections: ['develop'],
    after: { develop: { ...({} as object), exposure: i / 100 } as never },
  }));
  return { ...base, pictures: base.pictures.map((p) => ({ ...p, journal })) };
}

const size = (d: unknown) => new TextEncoder().encode(JSON.stringify(d)).byteLength;

describe('fitWireDoc', () => {
  it('leaves a roll under the cap alone', () => {
    const doc = heavyRoll(2, 5);
    expect(fitWireDoc(doc, 1024 * 1024).pictures[0].journal).toHaveLength(5);
    expect(fitWireDoc(doc, null).pictures[0].journal).toHaveLength(5);
  });

  it('thins the journals, never the pictures, until the roll fits', () => {
    const doc = heavyRoll(30, 300);
    const cap = 256 * 1024;
    expect(size(doc)).toBeGreaterThan(cap);
    const wire = fitWireDoc(doc, cap);
    expect(size(wire)).toBeLessThanOrEqual(cap);
    expect(wire.pictures).toHaveLength(30);
    expect(wire.pictures.map((p) => p.id)).toEqual(doc.pictures.map((p) => p.id));
  });

  it('does not touch the document it was given', () => {
    const doc = heavyRoll(30, 300);
    fitWireDoc(doc, 256 * 1024);
    expect(doc.pictures[0].journal).toHaveLength(300);
  });
});
