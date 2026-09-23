import { afterEach, describe, expect, it } from 'vitest';
import { deviceClass, deviceClassFor, isAppleMobile, overrideDeviceClass, type DeviceFacts } from './device-class';

const facts = (over: Partial<DeviceFacts>): DeviceFacts => ({
  platform: 'Win32',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0',
  maxTouchPoints: 0,
  deviceMemoryGiB: null,
  ...over,
});

afterEach(() => overrideDeviceClass(null));

describe('deviceClassFor', () => {
  it('calls every iPhone and iPad constrained — Safari says nothing about their memory', () => {
    expect(deviceClassFor(facts({ platform: 'iPhone', maxTouchPoints: 5 }))).toBe('constrained');
    expect(deviceClassFor(facts({ platform: 'iPad', maxTouchPoints: 5 }))).toBe('constrained');
    // iPadOS 13+ says it is a Mac; the touch screen is what gives it away.
    expect(deviceClassFor(facts({ platform: 'MacIntel', maxTouchPoints: 5 }))).toBe('constrained');
    expect(isAppleMobile({ platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
  });

  it('calls Android constrained, and a machine that says 4 GiB or less', () => {
    expect(deviceClassFor(facts({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/152.0', deviceMemoryGiB: 8 }))).toBe('constrained');
    expect(deviceClassFor(facts({ deviceMemoryGiB: 4 }))).toBe('constrained');
    expect(deviceClassFor(facts({ deviceMemoryGiB: 2 }))).toBe('constrained');
  });

  it('calls a desktop roomy — with a memory figure above 4 GiB, or with none at all', () => {
    expect(deviceClassFor(facts({ deviceMemoryGiB: 8 }))).toBe('roomy');
    expect(deviceClassFor(facts({ platform: 'MacIntel', deviceMemoryGiB: null }))).toBe('roomy');
    expect(deviceClassFor(facts({ platform: 'Linux x86_64', deviceMemoryGiB: 16 }))).toBe('roomy');
  });
});

describe('deviceClass', () => {
  it('answers roomy in node (no navigator), and takes an override', () => {
    expect(deviceClass()).toBe('roomy');
    overrideDeviceClass('constrained');
    expect(deviceClass()).toBe('constrained');
    overrideDeviceClass(null);
    expect(deviceClass()).toBe('roomy');
  });
});
