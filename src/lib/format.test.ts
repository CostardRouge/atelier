import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './format';

describe('formatBytes', () => {
  it('formats bytes, Ko, Mo, Go', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(1500)).toBe('1.5 Ko');
    expect(formatBytes(2_500_000)).toBe('2.5 Mo');
    expect(formatBytes(3_200_000_000)).toBe('3.2 Go');
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
    expect(formatDuration(null)).toBe('durée indisponible');
    expect(formatDuration(NaN)).toBe('durée indisponible');
  });
});
