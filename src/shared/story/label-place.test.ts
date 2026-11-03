import { describe, expect, it } from 'vitest';
import { placeLabel, type LabelBox } from './label-place';

const box = (x: number, y: number, w = 100, h = 20): LabelBox => ({ x, y, w, h });

describe('placeLabel', () => {
  it('takes its usual place when clear', () => {
    const placed: LabelBox[] = [];
    expect(placeLabel([box(0, 0)], placed)?.at).toBe(0);
    expect(placed).toHaveLength(1);
  });
  it('moves above, then to the other side, then gives up — never over another name', () => {
    const placed: LabelBox[] = [box(0, 0)];
    expect(placeLabel([box(10, 5), box(10, -40)], placed)?.at).toBe(1);
    expect(placeLabel([box(10, 5), box(10, -40), box(-200, 5)], placed)?.at).toBe(2);
    expect(placeLabel([box(10, 5), box(10, -40)], placed)).toBeNull();
    expect(placed).toHaveLength(3);
  });
});
