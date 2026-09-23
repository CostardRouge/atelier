import { describe, expect, it } from 'vitest';
import {
  CULL_FILTERS,
  countCulling,
  cullFilterKey,
  cullFilterLabel,
  cullingFromRow,
  describeCulling,
  isCulled,
  labelColour,
  passesCull,
  readCullFilter,
  type Culling,
} from './culling';

const pick: Culling = { verdict: 'pick', star: 3, color: 'red' };
const reject: Culling = { verdict: 'reject', star: 0, color: null };
const plain: Culling = { verdict: 'unrated', star: 0, color: null };

describe('cullingFromRow', () => {
  it('reads what GRID_SELECT joins', () => {
    expect(cullingFromRow({ verdict: 'pick', star: 4, color_label: 'green' })).toEqual({
      verdict: 'pick',
      star: 4,
      color: 'green',
    });
  });

  it('says nothing for a row that carries none of it', () => {
    expect(cullingFromRow({})).toBeNull();
  });

  it('reads an unknown verdict as unrated and clamps stars', () => {
    expect(cullingFromRow({ verdict: 'maybe', star: 9 })).toEqual({ verdict: 'unrated', star: 5, color: null });
    expect(cullingFromRow({ verdict: 'skip', star: -2, color_label: '  ' })).toEqual({
      verdict: 'skip',
      star: 0,
      color: null,
    });
  });
});

describe('what is said', () => {
  it('describes a culling in a line', () => {
    expect(describeCulling(pick)).toBe('Pick · ★★★ · red');
    expect(describeCulling(reject)).toBe('Rejected');
    expect(describeCulling(plain)).toBe('');
    expect(describeCulling(undefined)).toBe('');
  });

  it('knows an untouched row from a culled one', () => {
    expect(isCulled(plain)).toBe(false);
    expect(isCulled(undefined)).toBe(false);
    expect(isCulled({ ...plain, star: 1 })).toBe(true);
    expect(isCulled(reject)).toBe(true);
  });

  it('shows only the five shared label colours', () => {
    expect(labelColour('Red')).toBe('red');
    expect(labelColour('teal')).toBeNull();
    expect(labelColour(null)).toBeNull();
  });
});

describe('the filter', () => {
  it('keeps a picture Winnow said nothing of only where nothing is asked of it', () => {
    expect(passesCull(undefined, { kind: 'all' })).toBe(true);
    expect(passesCull(undefined, { kind: 'unrejected' })).toBe(true);
    expect(passesCull(undefined, { kind: 'picks' })).toBe(false);
    expect(passesCull(undefined, { kind: 'stars', min: 1 })).toBe(false);
  });

  it('filters on the verdict and the stars', () => {
    expect(passesCull(pick, { kind: 'picks' })).toBe(true);
    expect(passesCull(reject, { kind: 'unrejected' })).toBe(false);
    expect(passesCull(pick, { kind: 'stars', min: 3 })).toBe(true);
    expect(passesCull(pick, { kind: 'stars', min: 4 })).toBe(false);
  });

  it('round-trips every filter through its key, and falls back to none', () => {
    for (const f of CULL_FILTERS) expect(readCullFilter(cullFilterKey(f))).toEqual(f);
    expect(readCullFilter('stars:9')).toEqual({ kind: 'all' });
    expect(cullFilterLabel({ kind: 'stars', min: 3 })).toBe('★★★ and up');
    expect(cullFilterLabel({ kind: 'stars', min: 5 })).toBe('★★★★★');
  });

  it('counts what Winnow answered for', () => {
    expect(countCulling([pick, reject, plain, undefined, null])).toEqual({ known: 3, picks: 1, rejects: 1, starred: 1 });
  });
});
