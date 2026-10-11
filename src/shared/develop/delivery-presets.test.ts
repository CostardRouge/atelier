import { describe, expect, it } from 'vitest';
import { DELIVERY_PRESETS, findDeliveryPreset } from './delivery-presets';
import { MAX_TARGETS } from './export-targets';
import { patchRollExport } from './roll-settings-commands';
import { readRollExport } from './roll-types';

describe('delivery presets', () => {
  it('are found by id or name, case aside, else refused with the list', () => {
    expect(findDeliveryPreset('instagram').targets).toHaveLength(2);
    expect(findDeliveryPreset(' X / threads ').id).toBe('x');
    expect(() => findDeliveryPreset('tiktok')).toThrow(/no delivery preset "tiktok" — the presets are instagram/);
  });

  it('every preset is a list of targets the roll accepts as they are', () => {
    for (const preset of DELIVERY_PRESETS) {
      expect(preset.targets.length).toBeGreaterThan(0);
      expect(preset.targets.length).toBeLessThanOrEqual(MAX_TARGETS);
      const next = patchRollExport(readRollExport(undefined), { targets: preset.targets });
      expect(next.targets).toEqual(preset.targets);
    }
  });
});
