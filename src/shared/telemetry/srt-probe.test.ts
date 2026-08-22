import { describe, expect, it } from 'vitest';
import { probeSrtTiming } from './srt-probe';

const EPOCH = Date.UTC(2026, 4, 30, 5, 49, 34, 609);

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** A block in DJI's bracket format, timed on the file's own timeline. */
function block(i: number, mediaFps: number, captureFps: number): string {
  const start = i / mediaFps;
  const end = (i + 1) / mediaFps;
  const tc = (s: number) =>
    `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(
      Math.floor(s % 60),
    )},${pad(Math.round((s % 1) * 1000), 3)}`;
  const stamp = new Date(EPOCH + (i / captureFps) * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');
  return [
    String(i + 1),
    `${tc(start)} --> ${tc(end)}`,
    `<font size="28">FrameCnt: ${i + 1}, DiffTime: ${Math.round(1000 / captureFps)}ms`,
    stamp,
    `[iso: 100] [shutter: 1/500.0] [latitude: 16.056870] [longitude: -61.748979] [rel_alt: 35.200 abs_alt: 80.196] </font>`,
    '',
  ].join('\n');
}

function srt(frames: number, mediaFps: number, captureFps: number): Blob {
  let text = '';
  for (let i = 0; i < frames; i++) text += `${block(i, mediaFps, captureFps)}\n`;
  return new Blob([text], { type: 'application/x-subrip' });
}

describe('probeSrtTiming', () => {
  it('reads an ordinary clip as real time', async () => {
    const r = await probeSrtTiming(srt(400, 60, 60));
    expect(r.scale).toBe(1);
    expect(r.mediaFps).toBe(60);
  });

  it('measures a 4× conform from a file too big to read whole', async () => {
    // ~6 000 blocks ≈ 1 MB: well past the two 128 KB slices, so this exercises
    // the head+tail path, not the small-file shortcut.
    const file = srt(6000, 30, 120);
    expect(file.size).toBeGreaterThan(400 * 1024);
    const r = await probeSrtTiming(file);
    expect(r.scale).toBeCloseTo(0.25, 3);
    expect(r.mediaFps).toBe(30);
    expect(r.captureFps).toBe(120);
  });

  it('reads the same cadence whether it slices or not', async () => {
    const small = await probeSrtTiming(srt(300, 30, 120));
    const big = await probeSrtTiming(srt(6000, 30, 120));
    expect(small.scale).toBeCloseTo(big.scale, 3);
  });

  it('says nothing measurable for a file that is not DJI telemetry', async () => {
    const r = await probeSrtTiming(new Blob(['1\n00:00:00,000 --> 00:00:01,000\nHello\n']));
    expect(r.basis).toBe('none');
    expect(r.scale).toBe(1);
  });
});
