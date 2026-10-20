import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatTimecode } from './format';

describe('formatBytes', () => {
  it('formats bytes, KB, MB, GB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(2_500_000)).toBe('2.5 MB');
    expect(formatBytes(3_200_000_000)).toBe('3.2 GB');
  });

  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats M:SS and H:MM:SS', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('reports unavailable for null/invalid', () => {
    expect(formatDuration(null)).toBe('duration unavailable');
    expect(formatDuration(NaN)).toBe('duration unavailable');
  });
});

describe('format boundaries', () => {
  it('moves to the next unit when the rounded figure reaches 1000', () => {
    expect(formatBytes(999_960)).toBe('1.0 MB');
    expect(formatBytes(999_950_000)).toBe('1.0 GB');
    expect(formatBytes(999_400)).toBe('999 KB');
  });

  it('does not floor a centisecond low on binary fractions', () => {
    expect(formatTimecode(0.57)).toBe('0:00.57');
    expect(formatTimecode(0.29)).toBe('0:00.29');
    expect(formatTimecode(61.999)).toBe('1:01.99');
  });
});

