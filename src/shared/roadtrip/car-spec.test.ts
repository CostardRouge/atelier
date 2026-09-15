import { describe, expect, it } from 'vitest';
import {
  CAR_COLOURS,
  DEFAULT_CAR,
  DEFAULT_GEAR,
  GEAR_KEYS,
  colourName,
  defaultCarSpec,
  describeCar,
  effectiveGear,
  gearWords,
  readCarSpec,
  sameCarSpec,
} from './car-spec';

describe('the default car', () => {
  it('is the Prado in Raptor black, matte, with every piece of gear on', () => {
    const car = defaultCarSpec();
    expect(car.model).toBe('prado-j120');
    expect(car.finish).toBe('matte');
    expect(colourName(car.color)).toBe('Raptor black');
    expect(GEAR_KEYS.every((key) => car.gear[key])).toBe(true);
  });

  it('is a fresh object each time, never the frozen constant', () => {
    const a = defaultCarSpec();
    const b = defaultCarSpec();
    expect(a).not.toBe(b);
    expect(a.gear).not.toBe(b.gear);
    expect(a).toEqual(DEFAULT_CAR);
    expect(Object.isFrozen(DEFAULT_CAR)).toBe(true);
  });
});

describe('the presets', () => {
  it('are all readable hexes with distinct names, and the coating carries its finish', () => {
    for (const c of CAR_COLOURS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(CAR_COLOURS.map((c) => c.name)).size).toBe(CAR_COLOURS.length);
    expect(CAR_COLOURS.find((c) => c.id === 'raptor-black')?.finish).toBe('matte');
    expect(CAR_COLOURS.find((c) => c.id === 'dark-green')?.note).toBeTruthy();
  });

  it('names a colour by its hex, whatever the case, and calls the rest custom', () => {
    expect(colourName('#1F3B2F')).toBe('Dark green');
    expect(colourName('#123456')).toBe('Custom');
  });
});

describe('readCarSpec', () => {
  it('lands junk on the default', () => {
    expect(readCarSpec(null)).toEqual(DEFAULT_CAR);
    expect(readCarSpec('black')).toEqual(DEFAULT_CAR);
    expect(readCarSpec({ model: 'delorean', color: 'red', finish: 'chrome', gear: 3 })).toEqual(DEFAULT_CAR);
  });

  it('keeps what a partial spec says and fills the rest', () => {
    const car = readCarSpec({ color: '#FF0000', gear: { bullBar: false, solar: 'yes' } });
    expect(car.color).toBe('#ff0000');
    expect(car.finish).toBe('matte');
    expect(car.gear.bullBar).toBe(false);
    expect(car.gear.solar).toBe(true);
    expect(car.gear.spare).toBe(true);
  });

  it('reads a full spec back unchanged', () => {
    const spec = { model: 'prado-j120' as const, color: '#1f3b2f', finish: 'gloss' as const, gear: { ...DEFAULT_GEAR, rack: false } };
    expect(readCarSpec(spec)).toEqual(spec);
  });
});

describe('effectiveGear', () => {
  it('draws the spot lights only with the bar and the roof load only with the basket, leaving the flags stored', () => {
    const gear = { ...DEFAULT_GEAR, bullBar: false, rack: false };
    const shown = effectiveGear(gear);
    expect(shown.spotLights).toBe(false);
    expect(shown.solar).toBe(false);
    expect(shown.box).toBe(false);
    expect(shown.jerryCans).toBe(false);
    expect(shown.awning).toBe(false);
    expect(shown.mudFlaps).toBe(true);
    expect(gear.spotLights).toBe(true);
    expect(gear.solar).toBe(true);
  });
});

describe('describeCar', () => {
  it('says the model, the colour and finish, and the gear that is on', () => {
    expect(describeCar(defaultCarSpec(), 'Toyota Land Cruiser Prado')).toBe(
      'Toyota Land Cruiser Prado · Raptor black, matte · bull bar, spot lights, roof basket, solar panel, storage box, jerry cans, awning bag, mud flaps, window visors, spare wheel, door mirrors',
    );
  });

  it('says so when nothing is fitted, and lists only what is drawn', () => {
    const bare = { ...defaultCarSpec(), gear: { ...DEFAULT_GEAR, ...Object.fromEntries(GEAR_KEYS.map((k) => [k, false])) } };
    expect(describeCar(bare, 'Prado')).toBe('Prado · Raptor black, matte · no gear');
    expect(gearWords({ ...DEFAULT_GEAR, rack: false })).toEqual(['bull bar', 'spot lights', 'mud flaps', 'window visors', 'spare wheel', 'door mirrors']);
  });
});

describe('sameCarSpec', () => {
  it('is true for the same car whatever the case of its hex, false for one flag apart', () => {
    const a = defaultCarSpec();
    expect(sameCarSpec(a, defaultCarSpec())).toBe(true);
    expect(sameCarSpec(a, { ...a, color: a.color.toUpperCase() })).toBe(true);
    expect(sameCarSpec(a, { ...a, gear: { ...a.gear, spare: false } })).toBe(false);
    expect(sameCarSpec(a, { ...a, finish: 'gloss' })).toBe(false);
    expect(sameCarSpec(a, { ...a, color: '#1f3b2f' })).toBe(false);
  });
});
