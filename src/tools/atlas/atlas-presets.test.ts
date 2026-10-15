import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, type AtlasSettings } from './atlas-settings';
import {
  MAX_NAME,
  MAX_PRESETS,
  applyPreset,
  cleanName,
  isCurrent,
  presetNamed,
  presetSettings,
  readPresets,
  removePreset,
  savePreset,
  type AtlasPreset,
} from './atlas-presets';

/** Dials over one set of flights: a look of their own, and content that names those flights. */
function perth(): AtlasSettings {
  return sanitizeSettings({
    ...DEFAULT_SETTINGS,
    trail: { ...DEFAULT_SETTINGS.trail, width: 4.2 },
    camera: { ...DEFAULT_SETTINGS.camera, frame: 'zone', zone: { x0: 0.8, y0: 0.6, x1: 0.81, y1: 0.61 }, place: 'p3', picked: ['DJI_0001'] },
    hud: { ...DEFAULT_SETTINGS.hud, title: 'Perth', subtitle: 'May' },
    aircraft: { names: { FC8482: 'Mini 4 Pro' }, fallback: 'Mini', weights: { 'DJI Mini 4 Pro': 1 } },
  });
}

let n = 0;
const makeId = () => `p${++n}`;

describe('presetSettings', () => {
  it('keeps how the atlas draws and leaves out what names one set of flights', () => {
    const kept = presetSettings(perth());
    expect(kept.trail.width).toBe(4.2);
    expect(kept.camera.frame).toBe('zone');
    expect(kept.camera.zone).toBeNull();
    expect(kept.camera.place).toBeNull();
    expect(kept.camera.picked).toEqual([]);
    expect(kept.hud.title).toBe('');
    expect(kept.hud.subtitle).toBe('');
    expect(kept.aircraft).toEqual({ names: {}, fallback: '', weights: {} });
  });
});

describe('applyPreset', () => {
  it("dresses the screen in the preset and keeps the screen's own content", () => {
    const saved = savePreset([], 'Night', perth(), 1, makeId)!;
    const guadeloupe = sanitizeSettings({ ...DEFAULT_SETTINGS, hud: { ...DEFAULT_SETTINGS.hud, title: 'Guadeloupe' } });
    const next = applyPreset(guadeloupe, saved[0]);
    expect(next.trail.width).toBe(4.2);
    expect(next.camera.frame).toBe('zone');
    expect(next.hud.title).toBe('Guadeloupe');
    expect(next.camera.zone).toBeNull();
  });
});

describe('isCurrent', () => {
  it('lights the preset the dials match, whatever the content on screen', () => {
    const saved = savePreset([], 'Night', perth(), 1, makeId)!;
    expect(isCurrent(perth(), saved[0])).toBe(true);
    expect(isCurrent({ ...perth(), hud: { ...perth().hud, title: 'Elsewhere' } }, saved[0])).toBe(true);
    expect(isCurrent({ ...perth(), trail: { ...perth().trail, width: 2 } }, saved[0])).toBe(false);
  });
});

describe('savePreset', () => {
  it('puts a new name first', () => {
    const one = savePreset([], 'Night', DEFAULT_SETTINGS, 1, makeId)!;
    const two = savePreset(one, 'Day', DEFAULT_SETTINGS, 2, makeId)!;
    expect(two.map((p) => p.name)).toEqual(['Day', 'Night']);
  });

  it('replaces a preset of the same name in place, whatever its case', () => {
    const list = savePreset(savePreset([], 'Night', DEFAULT_SETTINGS, 1, makeId)!, 'Day', DEFAULT_SETTINGS, 2, makeId)!;
    const night = presetNamed(list, 'night')!;
    const next = savePreset(list, ' NIGHT ', perth(), 3, makeId)!;
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe(night.id);
    expect(next[1].name).toBe('NIGHT');
    expect(next[1].settings.trail.width).toBe(4.2);
    expect(next[1].savedAt).toBe(3);
  });

  it('refuses an empty name', () => {
    expect(savePreset([], '   ', DEFAULT_SETTINGS, 1, makeId)).toBeNull();
  });

  it('keeps at most MAX_PRESETS', () => {
    let list: AtlasPreset[] = [];
    for (let i = 0; i < MAX_PRESETS + 3; i++) list = savePreset(list, `P${i}`, DEFAULT_SETTINGS, i, makeId)!;
    expect(list).toHaveLength(MAX_PRESETS);
    expect(list[0].name).toBe(`P${MAX_PRESETS + 2}`);
  });
});

describe('removePreset', () => {
  it('takes one preset off the list', () => {
    const list = savePreset(savePreset([], 'A', DEFAULT_SETTINGS, 1, makeId)!, 'B', DEFAULT_SETTINGS, 2, makeId)!;
    expect(removePreset(list, list[0].id).map((p) => p.name)).toEqual(['A']);
  });
});

describe('cleanName', () => {
  it('trims, folds spaces and bounds the length', () => {
    expect(cleanName('  Night   look ')).toBe('Night look');
    expect(cleanName('x'.repeat(80))).toHaveLength(MAX_NAME);
  });
});

describe('readPresets', () => {
  it('drops what is malformed and sanitises every dial', () => {
    const read = readPresets([
      { id: 'a', name: 'Night', settings: { trail: { width: 999 } }, savedAt: 5 },
      { id: 'a', name: 'Duplicate id', settings: {} },
      { id: '', name: 'No id' },
      { id: 'b', name: '   ' },
      'nonsense',
      { id: 'c', name: 'Old', settings: null },
    ]);
    expect(read.map((p) => p.name)).toEqual(['Night', 'Old']);
    expect(read[0].settings.trail.width).toBeLessThanOrEqual(16);
    expect(read[1].savedAt).toBe(0);
    expect(readPresets({ not: 'a list' })).toEqual([]);
  });
});
