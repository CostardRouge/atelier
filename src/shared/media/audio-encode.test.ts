import { afterEach, describe, expect, it, vi } from 'vitest';
import { AAC_PRIMING_SAMPLES, delayedByAacPriming, pickAudioCodec } from './audio-encode';
import { planar } from './audio-mix';

describe('delayedByAacPriming', () => {
  it('puts AAC’s priming of silence in front of every channel, and nothing else', () => {
    const src = planar(48000, [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])]);
    const out = delayedByAacPriming(src);
    expect(out.length).toBe(3 + AAC_PRIMING_SAMPLES);
    expect(out.numberOfChannels).toBe(2);
    expect(Array.from(out.getChannelData(0).subarray(0, AAC_PRIMING_SAMPLES)).every((v) => v === 0)).toBe(true);
    expect(Array.from(out.getChannelData(1).subarray(AAC_PRIMING_SAMPLES))).toEqual([4, 5, 6]);
  });
});

describe('pickAudioCodec', () => {
  afterEach(() => vi.unstubAllGlobals());
  const encoderSupporting = (codecs: string[]) => {
    vi.stubGlobal('AudioData', class {});
    vi.stubGlobal('AudioEncoder', { isConfigSupported: async (c: { codec: string }) => ({ supported: codecs.includes(c.codec) }) });
  };

  it('takes AAC first, Opus where AAC is missing, and nothing where both are', async () => {
    encoderSupporting(['mp4a.40.2', 'opus']);
    expect(await pickAudioCodec(48000, 2)).toBe('aac');
    encoderSupporting(['opus']);
    expect(await pickAudioCodec(48000, 2)).toBe('opus');
    encoderSupporting([]);
    expect(await pickAudioCodec(48000, 2)).toBeNull();
  });

  it('answers none where the browser has no WebCodecs audio', async () => {
    expect(await pickAudioCodec(48000, 2)).toBeNull();
  });
});
