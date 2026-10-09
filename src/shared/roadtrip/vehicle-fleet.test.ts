import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CROSSINGS,
  addChange,
  addVehicle,
  changeOn,
  fleetOf,
  fleetVehicle,
  makeMain,
  readCrossings,
  readFleet,
  readVehicleRef,
  removeChange,
  removeVehicle,
  resolveRef,
  sameRef,
  updateChange,
  vehicleOnDay,
  withLookOn,
  type TripVehicle,
} from './vehicle-fleet';
import { DEFAULT_VEHICLE, defaultVehicleSpec } from './vehicle-spec';

/** The maintainer's Prado: green from the start, Raptor black matte from Melbourne. */
const prado = (): TripVehicle => ({
  id: 'main',
  spec: { ...defaultVehicleSpec('prado-j120'), color: '#1f3b2f', finish: 'gloss' },
  changes: [{ id: 'change-1', from: '2025-04-14', place: 'Melbourne', look: { color: '#232326', finish: 'matte', gear: DEFAULT_VEHICLE.gear } }],
});

describe('a vehicle on a day', () => {
  it('wears its start until its first change, and the change from that very day on', () => {
    const v = prado();
    expect(vehicleOnDay(v, '2025-03-01').color).toBe('#1f3b2f');
    expect(vehicleOnDay(v, '2025-04-13').color).toBe('#1f3b2f');
    expect(vehicleOnDay(v, '2025-04-14')).toMatchObject({ model: 'prado-j120', color: '#232326', finish: 'matte' });
    expect(vehicleOnDay(v, '2026-01-01').finish).toBe('matte');
    // No day: as it set off.
    expect(vehicleOnDay(v, null).color).toBe('#1f3b2f');
    expect(changeOn(v, '2025-03-01')).toBeNull();
  });

  it('keeps its model through every change: another model is another vehicle', () => {
    const v = readFleet([{ id: 'main', spec: defaultVehicleSpec('kadjar-ph2'), changes: [{ from: '2025-05-01', look: { model: 'prado-j120', color: '#ffffff' } }] }])[0];
    expect(vehicleOnDay(v, '2025-06-01').model).toBe('kadjar-ph2');
  });
});

describe('editing the story', () => {
  it('adds a change that starts from the look it repaints, kept in date order', () => {
    const v = addChange(prado(), '2025-03-20', 'Adelaide');
    expect(v.changes.map((c) => c.from)).toEqual(['2025-03-20', '2025-04-14']);
    expect(v.changes[0]).toMatchObject({ place: 'Adelaide', look: { color: '#1f3b2f', finish: 'gloss' } });
    expect(new Set(v.changes.map((c) => c.id)).size).toBe(2);
  });

  it('moves, renames and removes a change', () => {
    let v = updateChange(prado(), 'change-1', { from: '2025-02-01', place: '  ' });
    expect(v.changes[0].from).toBe('2025-02-01');
    expect(v.changes[0].place).toBeUndefined();
    v = removeChange(v, 'change-1');
    expect(v.changes).toEqual([]);
  });

  it('dresses the state in effect on a day — a piece after Melbourne repaints the black Prado', () => {
    const v = prado();
    const after = withLookOn(v, '2025-05-01', { ...vehicleOnDay(v, '2025-05-01'), color: '#5c1b21' });
    expect(after.spec.color).toBe('#1f3b2f');
    expect(after.changes[0].look.color).toBe('#5c1b21');
    const before = withLookOn(v, '2025-03-01', { ...v.spec, color: '#c3c5c8' });
    expect(before.spec.color).toBe('#c3c5c8');
    expect(before.changes[0].look.color).toBe('#232326');
  });
});

describe('the fleet', () => {
  it('adds, promotes and removes vehicles, never the last one', () => {
    let fleet = addVehicle([prado()], 'trafic-ph2');
    expect(fleet.map((v) => v.spec.model)).toEqual(['prado-j120', 'trafic-ph2']);
    fleet = makeMain(fleet, fleet[1].id);
    expect(fleet[0].spec.model).toBe('trafic-ph2');
    fleet = removeVehicle(fleet, fleet[0].id);
    expect(fleet).toHaveLength(1);
    expect(removeVehicle(fleet, fleet[0].id)).toHaveLength(1);
  });

  it('falls back to the main vehicle for an id it no longer holds', () => {
    const fleet = addVehicle([prado()], 'zoe-ph2');
    expect(fleetVehicle(fleet, 'gone').id).toBe('main');
    expect(fleetVehicle(fleet, fleet[1].id).spec.model).toBe('zoe-ph2');
  });

  it('reads junk as a fleet of one, never empty, ids unique, changes dated and sorted', () => {
    expect(readFleet(null)).toEqual(fleetOf(DEFAULT_VEHICLE));
    expect(readFleet([])).toEqual(fleetOf(DEFAULT_VEHICLE));
    const read = readFleet([
      { id: 'a', spec: { model: 'zoe-ph2' }, changes: [{ from: '2025-05-02' }, { from: 'never' }, { from: '2025-01-02' }] },
      { id: 'a', spec: 'junk' },
      7,
    ]);
    expect(read.map((v) => v.id)).toEqual(['a', 'a-2']);
    expect(read[0].changes.map((c) => c.from)).toEqual(['2025-01-02', '2025-05-02']);
    expect(read[1].spec).toEqual(DEFAULT_VEHICLE);
  });
});

describe('references and the water rule', () => {
  it('resolves one of the fleet on its day, or a borrowed model in its paint', () => {
    const fleet = [prado()];
    expect(resolveRef({ fleet: 'main' }, fleet, '2025-05-01').color).toBe('#232326');
    expect(resolveRef({ borrow: 'viper-jet' }, fleet, '2025-05-01').model).toBe('viper-jet');
    expect(resolveRef({ borrow: 'viper-jet', color: '#F0BF2C' }, fleet, null).color).toBe('#f0bf2c');
  });

  it('reads references defensively and compares them', () => {
    expect(readVehicleRef({ fleet: 'main' })).toEqual({ fleet: 'main' });
    expect(readVehicleRef({ borrow: 'alison-maree', color: 'red' })).toEqual({ borrow: 'alison-maree' });
    expect(readVehicleRef({ borrow: 'a bicycle' })).toBeUndefined();
    expect(readVehicleRef('main')).toBeUndefined();
    expect(sameRef({ borrow: 'viper-jet' }, { borrow: 'viper-jet', color: '' })).toBe(true);
    expect(sameRef({ fleet: 'main' }, undefined)).toBe(false);
  });

  it('reads the crossings rule: a boat for the boat, distances clamped', () => {
    expect(readCrossings(undefined)).toEqual(DEFAULT_CROSSINGS);
    const read = readCrossings({ auto: false, boat: 'prado-j120', bridgeKm: 99, shoreKm: -1 });
    expect(read).toEqual({ auto: false, boat: DEFAULT_CROSSINGS.boat, bridgeKm: 20, shoreKm: 0 });
    expect(readCrossings({ boat: 'spirit-of-tasmania' }).boat).toBe('spirit-of-tasmania');
  });
});
