import { describe, expect, it } from 'vitest';
import { flatRows, fontCss, fontGroups, fontMeta, nearestShipped, stepActive, type FontChoice } from './font-picker';

const F = (id: string, group: string, extra: Partial<FontChoice> = {}): FontChoice => ({ id, label: id, family: `"${id}", serif`, weights: [400], group, ...extra });
const OPTIONS = [F('Geist', 'Sans', { weights: [300, 400, 600] }), F('Fraunces', 'Serif'), F('Space Grotesk', 'Sans'), F('Élite', 'Display')];

describe('fontGroups', () => {
  it('groups in first-seen order and numbers rows as drawn', () => {
    const g = fontGroups(OPTIONS);
    expect(g.map((x) => x.group)).toEqual(['Sans', 'Serif', 'Display']);
    expect(g[0].items.map((i) => [i.choice.id, i.index])).toEqual([
      ['Geist', 0],
      ['Space Grotesk', 1],
    ]);
    expect(flatRows(g).map((c) => c.id)).toEqual(['Geist', 'Space Grotesk', 'Fraunces', 'Élite']);
  });
  it('searches names and groups, ignoring case and accents', () => {
    expect(flatRows(fontGroups(OPTIONS, 'GRO')).map((c) => c.id)).toEqual(['Space Grotesk']);
    expect(flatRows(fontGroups(OPTIONS, 'serif')).map((c) => c.id)).toEqual(['Fraunces']);
    expect(flatRows(fontGroups(OPTIONS, 'elite')).map((c) => c.id)).toEqual(['Élite']);
    expect(fontGroups(OPTIONS, 'zzz')).toEqual([]);
  });
});

describe('fontCss', () => {
  it('writes the nearest shipped weight, italic first', () => {
    expect(nearestShipped([300, 600], 500)).toBe(600);
    expect(fontCss(F('Geist', 'Sans', { weights: [300, 400, 600] }), 700, 18)).toBe('600 18px "Geist", serif');
    expect(fontCss(F('I', 'Serif', { italic: true }), 400, 13)).toBe('italic 400 13px "I", serif');
  });
  it('shows a note in place of the weights', () => {
    expect(fontMeta(F('a', 'x', { weights: [300, 600] }))).toBe('300 · 600');
    expect(fontMeta(F('a', 'x', { note: 'role' }))).toBe('role');
  });
});

describe('stepActive', () => {
  it('walks and stops at the ends', () => {
    expect(stepActive(-1, 4, 'ArrowDown')).toBe(0);
    expect(stepActive(-1, 4, 'ArrowUp')).toBe(3);
    expect(stepActive(3, 4, 'ArrowDown')).toBe(3);
    expect(stepActive(0, 4, 'ArrowUp')).toBe(0);
    expect(stepActive(1, 4, 'End')).toBe(3);
    expect(stepActive(2, 4, 'Home')).toBe(0);
    expect(stepActive(1, 20, 'PageDown')).toBe(7);
    expect(stepActive(3, 20, 'PageUp')).toBe(0);
    expect(stepActive(0, 0, 'ArrowDown')).toBe(-1);
  });
});
