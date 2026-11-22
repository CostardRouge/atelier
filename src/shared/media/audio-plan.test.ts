import { describe, expect, it } from 'vitest';
import { BED_KEPT_OUT, planAudio } from './audio-plan';

describe('planAudio', () => {
  it('keeps a clip’s own sound when nothing else wants to be heard', () => {
    expect(planAudio({ sourceAudio: true, bed: false, mix: false })).toEqual({
      kind: 'copy',
      droppedBed: null,
    });
  });

  it('writes nothing for a silent clip with nothing to add', () => {
    expect(planAudio({ sourceAudio: false, bed: false, mix: true })).toEqual({ kind: 'none' });
  });

  it('gives a clip with no microphone the bed as its track — no mixing needed', () => {
    expect(planAudio({ sourceAudio: false, bed: true, mix: false })).toEqual({ kind: 'bed' });
  });

  it('keeps a clip’s own sound by default, and says the ticks were left out', () => {
    expect(planAudio({ sourceAudio: true, bed: true, mix: false })).toEqual({
      kind: 'copy',
      droppedBed: BED_KEPT_OUT,
    });
  });

  it('mixes only when asked, over a clip that has sound', () => {
    expect(planAudio({ sourceAudio: true, bed: true, mix: true })).toEqual({ kind: 'mix' });
  });
});
