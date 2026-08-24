import { describe, expect, it } from 'vitest';
import { charBudget, wrapText } from './wrap-text';

describe('wrapText', () => {
  it('breaks on spaces, never mid-word', () => {
    expect(wrapText('the quick brown fox jumps', 10)).toEqual([
      'the quick',
      'brown fox',
      'jumps',
    ]);
  });

  it('fills each line up to the budget', () => {
    for (const line of wrapText('a bb ccc dddd eeeee ffffff', 12)) {
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it('leaves a single over-long word whole', () => {
    // A broken URL is worse than one that overhangs, and the caller can see
    // it happen.
    expect(wrapText('https://example.test/a/very/long/path', 10)).toEqual([
      'https://example.test/a/very/long/path',
    ]);
  });

  it('keeps a line break the author typed', () => {
    expect(wrapText('one\ntwo three', 20)).toEqual(['one', 'two three']);
  });

  it('wraps inside a typed paragraph too', () => {
    expect(wrapText('aaa bbb\nccc ddd', 4)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
  });

  it('drops a trailing blank line nobody asked for', () => {
    expect(wrapText('one\n', 20)).toEqual(['one']);
  });

  it('collapses runs of whitespace', () => {
    expect(wrapText('one    two', 20)).toEqual(['one two']);
  });

  it('survives an empty string and a nonsense budget', () => {
    expect(wrapText('', 10)).toEqual(['']);
    expect(wrapText('one two', 0)).toEqual(['one', 'two']);
    expect(wrapText('one two', -5)).toEqual(['one', 'two']);
  });
});

describe('charBudget', () => {
  it('gives more characters to a wider frame', () => {
    expect(charBudget(1000, 40)).toBeGreaterThan(charBudget(500, 40));
  });

  it('gives fewer to a bigger font', () => {
    expect(charBudget(1000, 80)).toBeLessThan(charBudget(1000, 40));
  });

  it('errs low — one word early is invisible, one word late overflows', () => {
    // A real sans averages nearer 0.5 em; budgeting at 0.55 wraps sooner.
    expect(charBudget(1000, 40)).toBeLessThan(1000 / (40 * 0.5));
  });

  it('never returns zero', () => {
    expect(charBudget(10, 1000)).toBeGreaterThanOrEqual(1);
    expect(charBudget(100, 0)).toBeGreaterThanOrEqual(1);
  });
});
