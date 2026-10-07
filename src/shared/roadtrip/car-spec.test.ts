import { describe, expect, it } from 'vitest';
import {
  CAR_LINES,
  CAR_MODEL_IDS,
  DEFAULT_CAR,
  DEFAULT_GEAR,
  GEAR_KEYS,
  carLine,
  colourName,
  defaultCarSpec,
  describeCar,
  effectiveGear,
  gearWords,
  readCarSpec,
  sameCarSpec,
  vehicleFor,
} from './car-spec';

describe('the default car', () => {
  it('is the Prado in Raptor black, matte, with every piece of its gear on', () => {
    const car = defaultCarSpec();
    expect(car.model).toBe('prado-j120');
    expect(car.finish).toBe('matte');
    expect(colourName(car.color, car.model)).toBe('Raptor black');
    expect(CAR_LINES['prado-j120'].gear.every((key) => car.gear[key])).toBe(true);
    expect(car.gear.roofRails || car.gear.roofBars).toBe(false);
    expect(car.gear).toEqual(DEFAULT_GEAR);
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

describe('the Kadjar', () => {
  it('comes in navy blue, gloss, with its two roof bars and its mirrors — and no rails', () => {
    const car = defaultCarSpec('kadjar-ph2');
    expect(car.model).toBe('kadjar-ph2');
    expect(car.finish).toBe('gloss');
    expect(colourName(car.color, car.model)).toBe('Navy blue');
    expect(car.gear.roofBars).toBe(true);
    expect(car.gear.mirrors).toBe(true);
    expect(car.gear.roofRails).toBe(false);
    expect(car.gear.bullBar).toBe(false);
  });

  it('offers only the gear it can wear', () => {
    expect([...CAR_LINES['kadjar-ph2'].gear].sort()).toEqual(['mirrors', 'roofBars', 'roofRails']);
    expect(CAR_LINES['prado-j120'].gear).not.toContain('roofBars');
  });
});

describe('the Trafic', () => {
  it('comes in white, gloss, with the solar panel on its roof and its mirrors', () => {
    const van = defaultCarSpec('trafic-ph2');
    expect(van.finish).toBe('gloss');
    expect(colourName(van.color, van.model)).toBe('Glacier white');
    expect(van.gear.roofSolar).toBe(true);
    expect(van.gear.mirrors).toBe(true);
    expect(van.gear.solar).toBe(false);
    expect([...CAR_LINES['trafic-ph2'].gear].sort()).toEqual(['mirrors', 'roofSolar']);
    expect(describeCar(van, 'Renault Trafic')).toBe('Renault Trafic · Glacier white, gloss · solar panel, door mirrors');
  });

  it('keeps its panel without a basket: the roof flag is not the Prado’s', () => {
    const van = defaultCarSpec('trafic-ph2');
    expect(effectiveGear(van.gear).roofSolar).toBe(true);
    expect(gearWords({ ...van.gear, solar: true, rack: true }, 'trafic-ph2')).toEqual(['solar panel', 'door mirrors']);
    expect(gearWords({ ...DEFAULT_GEAR, roofSolar: true }, 'prado-j120')).not.toContain('roofSolar');
  });
});

describe('the lines', () => {
  it('cover every model, each with readable, distinctly named colours that include its own', () => {
    for (const id of CAR_MODEL_IDS) {
      const line = CAR_LINES[id];
      for (const c of line.colours) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(line.colours.map((c) => c.name)).size).toBe(line.colours.length);
      expect(line.colours.some((c) => c.hex === line.color), id).toBe(true);
      for (const key of line.fitted) expect(line.gear, id).toContain(key);
      expect(line.asItComes).toBeTruthy();
    }
    const prado = CAR_LINES['prado-j120'].colours;
    expect(prado.find((c) => c.id === 'raptor-black')?.finish).toBe('matte');
    expect(prado.find((c) => c.id === 'dark-green')?.note).toBeTruthy();
  });

  it('answers the default car’s line for a model this build does not know', () => {
    expect(carLine('delorean')).toBe(CAR_LINES['prado-j120']);
  });

  it('names a colour by its hex within the model, whatever the case, and calls the rest custom', () => {
    expect(colourName('#1F3B2F', 'prado-j120')).toBe('Dark green');
    expect(colourName('#123456', 'prado-j120')).toBe('Custom');
    expect(colourName(defaultCarSpec('kadjar-ph2').color.toUpperCase(), 'kadjar-ph2')).toBe('Navy blue');
    // A Prado colour on the Kadjar is a colour of its own.
    expect(colourName('#1f3b2f', 'kadjar-ph2')).toBe('Custom');
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

  it('fills a Kadjar from what a Kadjar comes with, never from the Prado', () => {
    const car = readCarSpec({ model: 'kadjar-ph2', gear: { roofRails: true } });
    expect(car).toEqual({ ...defaultCarSpec('kadjar-ph2'), gear: { ...defaultCarSpec('kadjar-ph2').gear, roofRails: true } });
  });

  it('gives a spec stored before the roof bars existed their default, and reads a full one back unchanged', () => {
    const old = { model: 'prado-j120', color: '#1f3b2f', finish: 'gloss', gear: { ...DEFAULT_GEAR, rack: false } } as Record<string, unknown>;
    delete (old.gear as Record<string, unknown>).roofBars;
    delete (old.gear as Record<string, unknown>).roofRails;
    expect(readCarSpec(old).gear.roofBars).toBe(false);
    const spec = { model: 'kadjar-ph2' as const, color: '#a3161d', finish: 'matte' as const, gear: { ...defaultCarSpec('kadjar-ph2').gear, roofBars: false } };
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

  it('draws the roof bars with or without the rails', () => {
    const kadjar = defaultCarSpec('kadjar-ph2').gear;
    expect(effectiveGear(kadjar).roofBars).toBe(true);
    expect(effectiveGear({ ...kadjar, roofRails: true }).roofBars).toBe(true);
  });
});

describe('describeCar', () => {
  it('says the model, the colour and finish, and the gear that is on', () => {
    expect(describeCar(defaultCarSpec(), 'Toyota Land Cruiser Prado')).toBe(
      'Toyota Land Cruiser Prado · Raptor black, matte · bull bar, spot lights, roof basket, solar panel, storage box, jerry cans, awning bag, mud flaps, window visors, spare wheel, door mirrors',
    );
    expect(describeCar(defaultCarSpec('kadjar-ph2'), 'Renault Kadjar')).toBe('Renault Kadjar · Navy blue, gloss · roof bars, door mirrors');
  });

  it('says so when nothing is fitted, and lists only what is drawn on that model', () => {
    const bare = { ...defaultCarSpec(), gear: { ...DEFAULT_GEAR, ...Object.fromEntries(GEAR_KEYS.map((k) => [k, false])) } };
    expect(describeCar(bare, 'Prado')).toBe('Prado · Raptor black, matte · no gear');
    expect(gearWords({ ...DEFAULT_GEAR, rack: false }, 'prado-j120')).toEqual([
      'bull bar',
      'spot lights',
      'mud flaps',
      'window visors',
      'spare wheel',
      'door mirrors',
    ]);
    // A Prado flag carried on a Kadjar is not the Kadjar's gear.
    expect(gearWords({ ...defaultCarSpec('kadjar-ph2').gear, bullBar: true }, 'kadjar-ph2')).toEqual(['roof bars', 'door mirrors']);
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
    expect(sameCarSpec(a, defaultCarSpec('kadjar-ph2'))).toBe(false);
  });

  it('compares only the flags the model offers', () => {
    const k = defaultCarSpec('kadjar-ph2');
    expect(sameCarSpec(k, { ...k, gear: { ...k.gear, bullBar: true } })).toBe(true);
    expect(sameCarSpec(k, { ...k, gear: { ...k.gear, roofRails: true } })).toBe(false);
  });
});

describe('the boats', () => {
  it('offer no gear, come in gloss, and say so without a gear clause', () => {
    for (const id of ['whitsunday-cruiser', 'viper-jet', 'alison-maree', 'solar-whisper'] as const) {
      expect(CAR_LINES[id].gear, id).toEqual([]);
      expect(defaultCarSpec(id).finish).toBe('gloss');
    }
    expect(describeCar(defaultCarSpec('viper-jet'), 'Viper')).toBe('Viper · Black, gloss');
    expect(describeCar(defaultCarSpec('alison-maree'), 'Alison Maree')).toBe('Alison Maree · White, gloss');
  });

  it('may be a trip’s own vehicle, read back like any other', () => {
    const spec = defaultCarSpec('alison-maree');
    expect(readCarSpec(spec)).toEqual(spec);
  });
});

describe('vehicleFor', () => {
  const trip = { ...defaultCarSpec(), color: '#1f3b2f' };

  it('drives the trip’s car, as it is dressed, unless the piece borrowed another', () => {
    expect(vehicleFor('trip', '', trip)).toBe(trip);
    expect(vehicleFor('garbage', '#ffffff', trip)).toBe(trip);
    // Picking the trip's own model is the trip's car, dressing and all.
    expect(vehicleFor('prado-j120', '#ffffff', trip)).toBe(trip);
  });

  it('borrows a model as it comes, in the piece’s own paint when it has one', () => {
    expect(vehicleFor('viper-jet', '', trip)).toEqual(defaultCarSpec('viper-jet'));
    expect(vehicleFor('viper-jet', '#F0BF2C', trip).color).toBe('#f0bf2c');
    expect(vehicleFor('viper-jet', 'yellow', trip).color).toBe(defaultCarSpec('viper-jet').color);
    expect(vehicleFor('kadjar-ph2', '', trip).model).toBe('kadjar-ph2');
  });
});
