import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSrt } from './srt-parser';
import { findCue } from './find-cue';

const fixture = readFileSync(
  fileURLToPath(new URL('../../../tests/fixtures/sample.srt', import.meta.url)),
  'utf-8',
);

const cues = parseSrt(fixture);

describe('findCue', () => {
  it('returns the cue active at time t (last cue with start <= t)', () => {
    expect(findCue(cues, 0.02)?.frame).toBe(2);
  });

  it('returns the first cue exactly at its start', () => {
    expect(findCue(cues, 0)?.frame).toBe(1);
  });

  it('returns null before the first cue', () => {
    expect(findCue(cues, -1)).toBeNull();
  });

  it('returns the last cue past the end', () => {
    expect(findCue(cues, 9999)?.frame).toBe(3);
  });

  it('returns null for empty cue lists', () => {
    expect(findCue([], 5)).toBeNull();
  });
});
