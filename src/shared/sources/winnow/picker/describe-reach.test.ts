import { describe, expect, it } from 'vitest';
import { BROAD_MAX, BROAD_SLACK, cutoff, kept, pageFor, PRECISE, wantsMore } from './describe-reach';

const rows = (distances: number[]) => distances.map((distance, i) => ({ id: i + 1, distance }));

describe('a description’s reach', () => {
  it('Precise keeps the closest and never asks a second page', () => {
    const many = rows(Array.from({ length: 450 }, (_, i) => 0.6 + i * 0.0001));
    expect(kept(many, 'precise')).toHaveLength(PRECISE);
    expect(wantsMore(many, 'precise', 450)).toBe(false);
    // An instance whose pages are smaller than PRECISE is read until Precise holds its count, whatever the reach.
    const firstPage = rows(Array.from({ length: 100 }, () => 0.9));
    expect(wantsMore(firstPage, 'precise', 100)).toBe(true);
    expect(wantsMore(firstPage, 'broad', 100)).toBe(true);
    expect(wantsMore(firstPage, 'precise', null)).toBe(false);
    expect(cutoff('precise', 0.6)).toBe(Infinity);
    expect(pageFor('precise', 1000)).toBe(PRECISE);
    expect(pageFor('precise', 60)).toBe(60);
  });

  it('Broad keeps what stays near the BEST past the Precise few, whatever the absolute distances', () => {
    // The first PRECISE rows are kept whatever their distance: Broad is never narrower than Precise.
    const head = Array.from({ length: PRECISE }, () => 0.7);
    const near = rows([...head, 0.71, 0.74, 0.7 + BROAD_SLACK, 0.77, 0.8]);
    expect(kept(near, 'broad')).toHaveLength(PRECISE + 3);
    const shifted = rows([0.55, ...Array.from({ length: PRECISE - 1 }, () => 0.58), 0.6, 0.62, 0.7]);
    expect(kept(shifted, 'broad')).toHaveLength(PRECISE + 1);
    const few = rows([0.7, 0.9, 0.95]);
    expect(kept(few, 'broad')).toEqual(kept(few, 'precise'));
    expect(kept([], 'broad')).toEqual([]);
  });

  it('Broad reads on while the page ends inside the cutoff, and stops at the ceiling or the last page', () => {
    const head = Array.from({ length: PRECISE - 1 }, () => 0.71);
    expect(wantsMore(rows([0.7, ...head, 0.74]), 'broad', PRECISE + 1)).toBe(true);
    expect(wantsMore(rows([0.7, ...head, 0.9]), 'broad', PRECISE + 1)).toBe(false);
    expect(wantsMore(rows([0.7, ...head, 0.74]), 'precise', PRECISE + 1)).toBe(false);
    expect(wantsMore(rows([0.7, 0.72]), 'broad', null)).toBe(false);
    const full = rows(Array.from({ length: BROAD_MAX }, () => 0.7));
    expect(wantsMore(full, 'broad', BROAD_MAX)).toBe(false);
    expect(kept(rows(Array.from({ length: BROAD_MAX + 50 }, () => 0.7)), 'broad')).toHaveLength(BROAD_MAX);
    expect(pageFor('broad', 1000)).toBe(1000);
    expect(pageFor('broad', 200)).toBe(200);
  });
});
