import { describe, expect, it } from 'vitest';
import { LOOK_STRENGTH, defaultLookStrength } from './look-strength';
import { familyForLookName } from './lut-pack';

describe('a look’s default strength', () => {
  it('lands a creative look well under 100 %, a conversion whole', () => {
    expect(LOOK_STRENGTH).toBeLessThan(1);
    expect(defaultLookStrength('rec709')).toBe(LOOK_STRENGTH);
    expect(defaultLookStrength('log')).toBe(1);
  });

  it('tells the two apart by name for a built-in or an upload', () => {
    expect(defaultLookStrength(familyForLookName('dji_mini_4_pro_d-log_m-to-rec709.cube'))).toBe(1);
    expect(defaultLookStrength(familyForLookName('Apple-Log-2-Rec709.cube'))).toBe(1);
    expect(defaultLookStrength(familyForLookName('filmic-contrast.cube'))).toBe(LOOK_STRENGTH);
    expect(defaultLookStrength(familyForLookName('warm.cube'))).toBe(LOOK_STRENGTH);
  });
});
