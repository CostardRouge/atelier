import { describe, expect, it } from 'vitest';
import { measurePoolSize } from './measure-pool';

describe('measurePoolSize', () => {
  it('leaves one core to the page, two to six workers on a computer', () => {
    expect(measurePoolSize(2, 'roomy')).toBe(2);
    expect(measurePoolSize(4, 'roomy')).toBe(3);
    expect(measurePoolSize(8, 'roomy')).toBe(6);
    expect(measurePoolSize(16, 'roomy')).toBe(6);
  });

  it('spawns one or two on a constrained device, whose memory each worker costs', () => {
    expect(measurePoolSize(2, 'constrained')).toBe(1);
    expect(measurePoolSize(6, 'constrained')).toBe(2);
    expect(measurePoolSize(8, 'constrained')).toBe(2);
  });

  it('survives a browser that says nothing', () => {
    expect(measurePoolSize(Number.NaN, 'roomy')).toBe(2);
    expect(measurePoolSize(0, 'constrained')).toBe(1);
  });
});
