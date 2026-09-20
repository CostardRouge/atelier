import { describe, expect, it } from 'vitest';
import { probeHdrSupport } from './hdr-display';

describe('probeHdrSupport', () => {
  it('says what the display and the canvas can do, and never claims a stage it has not got', () => {
    const sdr = probeHdrSupport({ matches: () => false, canvasColorSpaces: [] });
    expect(sdr).toMatchObject({ display: false, canvas: false });
    expect(sdr.line).toContain('SDR');
    const hdrScreen = probeHdrSupport({ matches: (q) => q === '(dynamic-range: high)', canvasColorSpaces: ['srgb'] });
    expect(hdrScreen).toMatchObject({ display: true, canvas: false });
    expect(hdrScreen.line).toContain('canvas draws SDR only');
    const both = probeHdrSupport({ matches: () => true, canvasColorSpaces: ['rec2100-pq'] });
    expect(both.canvas).toBe(true);
    expect(both.line).toContain('still shows the SDR base');
  });
});
