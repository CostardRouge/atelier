import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { addPictures, createRollDoc, type RollDoc } from './roll-types';
import { readRollSummary, rollSummary, summaryCard } from './roll-summary';

function roll(n: number): RollDoc {
  return addPictures(
    createRollDoc('Désert', 'winnow.example', 10, 'r1'),
    Array.from({ length: n }, (_, i) => ({ name: `p${i}.jpg`, size: 1, lastModified: 1 })),
    20,
  );
}

describe('rollSummary', () => {
  it('says what the card draws, and nothing of the pictures but four ids', () => {
    const doc = roll(6);
    const edited = {
      ...doc,
      pictures: doc.pictures.map((p, i) => (i < 2 ? { ...p, develop: { ...DEFAULT_DEVELOP, exposure: 0.5 } } : p)),
    };
    const s = rollSummary(edited);
    expect(s).toMatchObject({ name: 'Désert', createdAt: 10, pictures: 6, developed: 2, withLook: 0 });
    expect(s.cover).toEqual(edited.pictures.slice(0, 4).map((p) => p.id));
  });

  it('stays small however big the roll', () => {
    expect(JSON.stringify(rollSummary(roll(300))).length).toBeLessThan(1024);
  });

  it('reads back what it wrote, and refuses what is not a summary', () => {
    const s = rollSummary(roll(3));
    expect(readRollSummary(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(readRollSummary(null)).toBeNull();
    expect(readRollSummary({ name: 3 })).toBeNull();
    expect(readRollSummary([])).toBeNull();
  });

  it('draws a card with no pictures — never a roll to write', () => {
    const card = summaryCard('r1', 'winnow.example', rollSummary(roll(3)));
    expect(card).toMatchObject({ id: 'r1', name: 'Désert', sourceId: 'winnow.example', pictures: [] });
  });
});
