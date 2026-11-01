import { describe, expect, it } from 'vitest';
import { createMosaicDoc, withTiles, type MosaicDoc } from './mosaic-doc';
import { mosaicSummary, readMosaicSummary, summaryCard } from './mosaic-summary';

function sample(): MosaicDoc {
  const doc = createMosaicDoc('Iceland', 'winnow.example', 1_000);
  return {
    ...withTiles(doc, [
      { id: 1, kind: 'photo', grid: 'A'.repeat(144) },
      { id: 2, kind: 'clip' },
      { id: 3, kind: 'photo', failed: true },
    ]),
    instance: 'winnow.example',
    updatedAt: 2_000,
  };
}

describe('a mosaic’s summary', () => {
  it('is its title, its dates, its counts and where its pictures come from — never a grid', () => {
    const s = mosaicSummary(sample());
    expect(s).toEqual({ title: 'Iceland', createdAt: 1_000, updatedAt: 2_000, pictures: 3, measured: 1, instance: 'winnow.example' });
    expect(JSON.stringify(s)).not.toContain('AAAA');
  });

  it('reads back what it wrote, and refuses what is not one', () => {
    const s = mosaicSummary(sample());
    expect(readMosaicSummary(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(readMosaicSummary(null)).toBeNull();
    expect(readMosaicSummary([])).toBeNull();
    expect(readMosaicSummary({ title: 'x' })).toBeNull();
    // Counts bounded: never negative, never more measured than pictures.
    expect(readMosaicSummary({ title: 'x', updatedAt: 5, pictures: -3, measured: 9 })).toEqual({ title: 'x', createdAt: 5, updatedAt: 5, pictures: 0, measured: 0 });
  });

  it('draws a card that holds no picture', () => {
    const card = summaryCard('m1', 'winnow.example', mosaicSummary(sample()));
    expect(card).toMatchObject({ id: 'm1', title: 'Iceland', sourceId: 'winnow.example', instance: 'winnow.example', createdAt: 1_000, updatedAt: 2_000 });
    expect(card.tiles).toEqual([]);
    expect(card.target).toBeUndefined();
  });
});
