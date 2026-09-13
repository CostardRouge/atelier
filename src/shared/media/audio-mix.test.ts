import { describe, expect, it } from 'vitest';
import { mixPlanar, planar } from './audio-mix';

const ch = (...values: number[]) => new Float32Array(values);

describe('mixPlanar', () => {
  it('sums the bed into a stereo clip, channel for channel', () => {
    const out = mixPlanar(planar(48000, [ch(0.1, 0.2, 0.3), ch(-0.1, 0, 0.1)]), planar(48000, [ch(0.5, 0, 0), ch(0, 0.5, 0)]));
    expect([...out.getChannelData(0)]).toEqual([0.6, 0.2, 0.3].map(Math.fround));
    expect([...out.getChannelData(1)].map((v) => +v.toFixed(5))).toEqual([-0.1, 0.5, 0.1]);
  });

  it('folds a stereo bed down to the middle of a mono clip', () => {
    const out = mixPlanar(planar(44100, [ch(0, 0)]), planar(44100, [ch(0.4, 0), ch(0, 0.4)]));
    expect([...out.getChannelData(0)].map((v) => +v.toFixed(5))).toEqual([0.2, 0.2]);
  });

  it('clamps instead of wrapping when the sum passes full scale', () => {
    const out = mixPlanar(planar(48000, [ch(0.9, -0.9)]), planar(48000, [ch(0.5, -0.5)]));
    expect([...out.getChannelData(0)]).toEqual([1, -1]);
  });

  it('keeps the clip’s length and layout — a longer bed never extends it', () => {
    const out = mixPlanar(planar(48000, [ch(0, 0), ch(0, 0)]), planar(48000, [ch(0.1, 0.1, 0.1, 0.1), ch(0.1, 0.1, 0.1, 0.1)]));
    expect(out.length).toBe(2);
    expect(out.numberOfChannels).toBe(2);
  });

  it('never writes into the clip it was handed', () => {
    const clip = ch(0.1, 0.1);
    mixPlanar(planar(48000, [clip]), planar(48000, [ch(0.5, 0.5)]));
    expect([...clip]).toEqual([0.1, 0.1].map(Math.fround));
  });

  it('applies the bed’s gain before summing', () => {
    const out = mixPlanar(planar(48000, [ch(0)]), planar(48000, [ch(0.8)]), 0.5);
    expect(+out.getChannelData(0)[0].toFixed(5)).toBe(0.4);
  });
});
