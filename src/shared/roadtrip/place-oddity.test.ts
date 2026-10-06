import { describe, expect, it } from 'vitest';
import { ODD_KM, placeOddity, stageReference } from './place-oddity';
import { createTripDoc, createTripPlace, createTripStage } from './trip-types';

const KALBARRI = { lat: -27.71, lon: 114.16 };
const EXMOUTH_WA = { lat: -21.93, lon: 114.13 };
const EXMOUTH_DEVON = { lat: 50.62, lon: -3.41 };

describe('placeOddity', () => {
  it('suspects a place in another country AND far from what it is measured against', () => {
    const o = placeOddity({ countryCode: 'GB', coords: EXMOUTH_DEVON }, KALBARRI, 'AU');
    expect(o.odd).toBe(true);
    expect(o.km).toBeGreaterThan(14_000);
  });

  it('never suspects the trip’s own country, however far', () => {
    expect(placeOddity({ countryCode: 'au', coords: EXMOUTH_WA }, { lat: -12.46, lon: 130.84 }, 'AU').odd).toBe(false);
  });

  it('never suspects a stopover abroad photographed where it is', () => {
    const bali = { lat: -8.65, lon: 115.22 };
    expect(placeOddity({ countryCode: 'ID', coords: bali }, { lat: -8.6, lon: 115.1 }, 'AU')).toMatchObject({ odd: false });
  });

  it('says nothing where a side has no position or the trip no country', () => {
    expect(placeOddity({ countryCode: 'GB', coords: null }, KALBARRI, 'AU')).toEqual({ odd: false, km: null });
    expect(placeOddity({ countryCode: 'GB', coords: EXMOUTH_DEVON }, null, 'AU')).toEqual({ odd: false, km: null });
    expect(placeOddity({ countryCode: 'GB', coords: EXMOUTH_DEVON }, KALBARRI, '').odd).toBe(false);
    expect(placeOddity({ coords: EXMOUTH_DEVON }, KALBARRI, 'AU').odd).toBe(false);
  });

  it('draws its line at ODD_KM', () => {
    expect(placeOddity({ countryCode: 'NZ', coords: { lat: 0, lon: 0 } }, { lat: 0, lon: 0 }, 'AU', ODD_KM).odd).toBe(false);
  });
});

describe('stageReference', () => {
  it('is the centre of the stage’s other places, else of the trip’s', () => {
    const exmouth = createTripPlace('Exmouth', 'England', EXMOUTH_DEVON, { countryCode: 'GB' });
    const stage = createTripStage('', '', '2025-11-20', '2025-11-24', [
      createTripPlace('Kalbarri', 'Western Australia', KALBARRI),
      createTripPlace('Carnarvon', 'Western Australia', { lat: -24.88, lon: 113.66 }),
      exmouth,
    ]);
    const trip = { ...createTripDoc('WA', '2025-11-01', '2025-11-30'), stages: [stage] };
    const ref = stageReference(stage, exmouth.id, trip)!;
    expect(ref.lat).toBeCloseTo((-27.71 - 24.88) / 2, 5);

    const alone = createTripStage('', '', '2025-11-26', '2025-11-28', [exmouth]);
    const t2 = { ...trip, stages: [stage, alone] };
    expect(stageReference(alone, exmouth.id, t2)!.lat).toBeCloseTo((-27.71 - 24.88) / 2, 5);
    expect(stageReference(alone, exmouth.id, { stages: [alone] })).toBeNull();
  });
});
