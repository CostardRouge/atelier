import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE_SOUND, decodeStageSound, encodeStageSound } from './studio-sound';

describe('stage sound preference', () => {
  it('starts silent', () => {
    expect(decodeStageSound(null)).toEqual(DEFAULT_STAGE_SOUND);
    expect(DEFAULT_STAGE_SOUND.on).toBe(false);
  });

  it('reads back what it wrote', () => {
    const sound = { on: true, volume: 0.35 };
    expect(decodeStageSound(encodeStageSound(sound))).toEqual(sound);
  });

  it('survives anything else stored under its key', () => {
    expect(decodeStageSound('not json')).toEqual(DEFAULT_STAGE_SOUND);
    expect(decodeStageSound('{"on":"yes","volume":7}')).toEqual({ on: false, volume: 1 });
    expect(decodeStageSound('{"on":true,"volume":-2}')).toEqual({ on: true, volume: 0 });
  });
});
