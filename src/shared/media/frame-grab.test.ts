import { describe, expect, it } from 'vitest';
import { frameGrabName } from './frame-grab';

describe('frameGrabName', () => {
  it('stamps seconds under a minute', () => {
    expect(frameGrabName('DJI_0001', 7.6)).toBe('DJI_0001-frame-7s.jpg');
  });

  it('stamps minutes and zero-padded seconds past a minute', () => {
    expect(frameGrabName('vol', 72.4)).toBe('vol-frame-1m12s.jpg');
    expect(frameGrabName('vol', 605)).toBe('vol-frame-10m05s.jpg');
  });

  it('drops any extension from the base and floors the time', () => {
    expect(frameGrabName('clip.mp4', 0.9)).toBe('clip-frame-0s.jpg');
  });

  it('falls back on an empty base and clamps negative times', () => {
    expect(frameGrabName('   ', -3)).toBe('frame-frame-0s.jpg');
  });
});
