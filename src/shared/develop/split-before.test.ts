import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP, type DevelopSettings } from './develop';
import { park } from './parked';
import { beforeChoices, beforeDevelop, beforeKeys, beforeLabel, effectiveBefore } from './split-before';

const dev = (over: Partial<DevelopSettings>): DevelopSettings => ({ ...DEFAULT_DEVELOP, ...over });
const edited = () => dev({ exposure: 0.45, contrast: 22, saturation: -8, vibrance: 40 });

describe('what the left side can go without', () => {
  it('offers As shot, the sections set, then the sliders set', () => {
    expect(beforeChoices(edited()).map((c) => c.label)).toEqual([
      'As shot',
      'Without Light',
      'Without Colour',
      'Without Exposure',
      'Without Contrast',
      'Without Saturation',
      'Without Vibrance',
    ]);
  });

  it('offers only As shot on a picture with nothing set', () => {
    expect(beforeChoices(null).map((c) => c.id)).toEqual(['shot']);
  });

  it('never offers a switched-off slider: there is nothing to take away', () => {
    expect(beforeChoices(park(edited(), ['vibrance'])).map((c) => c.id)).not.toContain('k:vibrance');
  });

  it('never offers the RAW white balance', () => {
    const raw = dev({ base: 'gain', rawWb: { kelvin: 5200, tint: 0, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] } });
    expect(beforeChoices(raw).map((c) => c.id)).toEqual(['shot']);
  });
});

describe('what the left side renders', () => {
  it('is null for as shot', () => {
    expect(beforeDevelop(edited(), 'shot')).toBeNull();
  });

  it('is the develop without a slider, everything else kept', () => {
    const d = beforeDevelop(edited(), 'k:vibrance')!;
    expect([d.vibrance, d.saturation, d.exposure]).toEqual([0, -8, 0.45]);
  });

  it('is the develop without a whole section', () => {
    const d = beforeDevelop(edited(), 'g:colour')!;
    expect([d.vibrance, d.saturation, d.exposure]).toEqual([0, 0, 0.45]);
  });

  it('falls back to as shot on a picture where nothing of the choice is set, the choice kept', () => {
    const other = dev({ exposure: 1 });
    expect(effectiveBefore(other, 'g:colour')).toBe('shot');
    expect(beforeDevelop(other, 'g:colour')).toBeNull();
    expect(effectiveBefore(edited(), 'g:colour')).toBe('g:colour');
  });

  it('labels and keys', () => {
    expect(beforeLabel('shot')).toBe('before');
    expect(beforeLabel('g:colour')).toBe('without Colour');
    expect(beforeLabel('k:vibrance')).toBe('without Vibrance');
    expect(beforeKeys('g:light')).toEqual(['exposure', 'brightness', 'contrast']);
  });
});
