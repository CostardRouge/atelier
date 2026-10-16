import { describe, expect, it } from 'vitest';
import { breakLines, fitSize } from './atlas-text';

// Ten pixels a character.
const measure = (t: string) => t.length * 10;

describe('breakLines', () => {
  it('leaves a text that fits on one line', () => {
    expect(breakLines('Perth', 100, measure)).toEqual(['Perth']);
  });

  it('breaks between words where the line would pass the width', () => {
    expect(breakLines('Western Australia with the Mini', 120, measure)).toEqual(['Western', 'Australia', 'with the', 'Mini']);
  });

  it('keeps the author’s own line breaks, and drops the empty ends', () => {
    expect(breakLines('\nWestern\n\nAustralia\n\n', 500, measure)).toEqual(['Western', '', 'Australia']);
  });

  it('keeps a word wider than the width whole', () => {
    expect(breakLines('Kununurra-Wyndham ok', 60, measure)).toEqual(['Kununurra-Wyndham', 'ok']);
  });
});

describe('fitSize', () => {
  const scaled = (t: string, size: number) => t.length * size;
  it('shrinks to bring the widest line inside, and never grows', () => {
    expect(fitSize(['abcd', 'ab'], 10, 20, scaled)).toBe(5);
    expect(fitSize(['ab'], 10, 100, scaled)).toBe(10);
  });
});
