import { describe, expect, it } from 'vitest';
import { PART_KINDS } from '../../shared/develop/layer';
import { kindLabel, paletteGroups, paletteTitle, takesPointer } from './kind-palette';

const kinds = (mode: Parameters<typeof paletteGroups>[0]) => paletteGroups(mode).flatMap((g) => g.kinds.map((k) => k.kind));

describe('the palette of mask kinds', () => {
  it('offers every kind, grouped by what the author does, to a new layer or a new kind', () => {
    expect(paletteGroups('new').map((g) => g.label)).toEqual(['Point at it', 'Draw it', 'Everywhere']);
    expect(kinds('new')).toEqual(['subject', 'colour', 'luma', 'linear', 'radial', 'shade', 'brush', 'whole']);
    expect(kinds('type')).toEqual(kinds('new'));
  });

  it('offers a TERM only the kinds a term may be — never a subject, never the whole picture', () => {
    expect(new Set(kinds('part'))).toEqual(new Set(PART_KINDS));
    expect(kinds('part-type')).toEqual(kinds('part'));
    // A group with nothing left in it is not drawn.
    expect(paletteGroups('part').map((g) => g.id)).toEqual(['pick', 'draw']);
  });

  it('gives every kind a line of use, and names the question it asks', () => {
    for (const g of paletteGroups('new')) for (const k of g.kinds) expect(k.line.length).toBeGreaterThan(10);
    expect(paletteTitle('part')).toBe('Combine with…');
    expect(kindLabel(null)).toBe('Whole picture');
    expect(kindLabel('brush')).toBe('Painted');
  });

  it('turns the pointer on for the kinds that are made with it', () => {
    expect(['subject', 'colour', 'brush'].every((k) => takesPointer(k as never))).toBe(true);
    expect([null, 'whole', 'linear', 'luma'].some((k) => takesPointer(k as never))).toBe(false);
  });
});
