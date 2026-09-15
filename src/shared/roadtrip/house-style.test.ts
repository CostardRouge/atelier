import { describe, expect, it } from 'vitest';
import {
  HOUSE_STYLE_KIND,
  applyHouseStyle,
  houseStyleFrom,
  readHouseStyle,
  serializeHouseStyle,
} from './house-style';
import {
  TRIP_DOC_VERSION,
  createTripDoc,
  createTripPost,
  createTripStage,
  defaultPostBadge,
  hookDefaultsFrom,
  type TripDoc,
} from './trip-types';
import { FRENCH_BADGE_WORDS } from './day-badge';
import { DEFAULT_CTA } from './cta-slide';
import { createShade } from './shades';
import { themeFromPreset } from '../overlay/title-styles';
import { DEFAULT_DEVELOP } from '../develop/develop';
import { HOOK_VARIANTS } from './hooks/registry';

const picture = {
  ref: { name: 'DJI_0042.JPG', size: 10, lastModified: 1, hash: 'h42' },
  date: '2025-07-03',
};

/** A trip with a look worth keeping, and a journey that must not travel with it. */
function styledTrip(): TripDoc {
  const doc = createTripDoc('Australie', 'Australia', '2025-07-01', '2025-07-10');
  const reel = hookDefaultsFrom({
    ...defaultPostBadge('reel'),
    shades: [createShade({ strength: 0.4 }), createShade({ direction: 'top' })],
    hook: [{ id: 'scrub', options: { picked: [picture], sweepSeconds: 2.5 } }],
  });
  const photo = hookDefaultsFrom({
    ...defaultPostBadge('photo'),
    hook: [
      {
        id: 'map',
        options: { stops: [{ id: 's1', name: 'Uluru', lat: -25.3, lon: 131, picture }], size: 0.6 },
      },
    ],
  });
  return {
    ...doc,
    badgeWords: { ...FRENCH_BADGE_WORDS },
    theme: themeFromPreset('or-cine'),
    cta: { ...DEFAULT_CTA, headline: 'Suivez la route' },
    hookDefaults: { reel, photo },
    grade: {
      layers: [
        { id: 'l1', source: 'classic-warm', name: 'Warm', customText: null, intensity: 0.7, enabled: true },
        { id: 'l2', source: 'upload', name: 'Mine.cube', customText: 'LUT_3D_SIZE 2', intensity: 1, enabled: true },
      ],
      output: 'none',
    },
    car: { ...doc.car, color: '#1f3a2c' },
    stages: [createTripStage('Red Centre', 'NT', '2025-07-02', '2025-07-05')],
    posts: [createTripPost('reel', '2025-07-03', 'Sunset')],
    developPresets: [{ id: 'p1', name: 'Noon', settings: { ...DEFAULT_DEVELOP, exposure: 1 } }],
  };
}

describe('the house style', () => {
  it('carries the look of a trip and nothing of its journey', () => {
    const { style } = houseStyleFrom(styledTrip()).file;
    expect(Object.keys(style).sort()).toEqual(
      ['badgeWords', 'car', 'cta', 'grade', 'hookDefaults', 'theme'].sort(),
    );
    expect(style.badgeWords).toEqual(FRENCH_BADGE_WORDS);
    expect(style.theme?.presetId).toBe('or-cine');
    expect(style.cta.headline).toBe('Suivez la route');
    expect(style.car.color).toBe('#1f3a2c');
    const text = serializeHouseStyle(houseStyleFrom(styledTrip()).file);
    for (const journey of ['Australie', 'Red Centre', 'Sunset', 'Noon']) {
      expect(text).not.toContain(journey);
    }
  });

  it('puts back what an opener was given for one piece, and keeps how it draws', () => {
    const { style } = houseStyleFrom(styledTrip()).file;
    expect(style.hookDefaults.reel?.hook[0].options).toMatchObject({ picked: [], sweepSeconds: 2.5 });
    expect(style.hookDefaults.photo?.hook[0].options).toMatchObject({ stops: [], size: 0.6 });
    expect(serializeHouseStyle(houseStyleFrom(styledTrip()).file)).not.toContain('DJI_0042');
  });

  it('declares every list an opener stores as content, so none can smuggle a picture', () => {
    // A look option is a number, a word or a colour; a LIST in a variant's
    // defaults is something picked for a piece. A new variant that adds one
    // without declaring it fails here, not in a stranger's first trip.
    for (const variant of HOOK_VARIANTS) {
      const lists = Object.entries(variant.defaults)
        .filter(([, value]) => Array.isArray(value))
        .map(([key]) => key);
      expect(variant.contentKeys ?? [], variant.id).toEqual(expect.arrayContaining(lists));
    }
  });

  it('leaves an uploaded look out of the grade, and says which', () => {
    const snapshot = houseStyleFrom(styledTrip());
    expect(snapshot.file.style.grade.layers.map((l) => l.name)).toEqual(['Warm']);
    expect(snapshot.uploadedLooks).toEqual(['Mine.cube']);
  });

  it('writes the same text for the same trip, shades included', () => {
    const trip = styledTrip();
    const first = serializeHouseStyle(houseStyleFrom(trip).file);
    const second = serializeHouseStyle(houseStyleFrom(trip).file);
    expect(second).toBe(first);
    expect(houseStyleFrom(trip).file.style.hookDefaults.reel?.shades.map((s) => s.id)).toEqual([
      'shade-1',
      'shade-2',
    ]);
  });

  it('reads back what it wrote', () => {
    const { file } = houseStyleFrom(styledTrip());
    expect(file.kind).toBe(HOUSE_STYLE_KIND);
    expect(file.version).toBe(TRIP_DOC_VERSION);
    expect(readHouseStyle(JSON.parse(serializeHouseStyle(file)))).toEqual(file.style);
  });

  it('refuses what is not a house style, or one from a newer build', () => {
    const { file } = houseStyleFrom(styledTrip());
    expect(readHouseStyle(null)).toBeNull();
    expect(readHouseStyle({ ...file, kind: 'atelier.trip' })).toBeNull();
    expect(readHouseStyle({ ...file, version: TRIP_DOC_VERSION + 1 })).toBeNull();
    expect(readHouseStyle({ ...file, version: '20' })).toBeNull();
    expect(readHouseStyle({ ...file, style: [] })).toBeNull();
  });

  it('migrates a file written by an older build', () => {
    // v19 still had the Route trace; v20 converts it into an Itinerary.
    const { file } = houseStyleFrom(styledTrip());
    const old = {
      ...file,
      version: 19,
      style: {
        ...file.style,
        hookDefaults: {
          reel: { ...file.style.hookDefaults.reel, hook: [{ id: 'route', options: {} }] },
        },
      },
    };
    const style = readHouseStyle(JSON.parse(JSON.stringify(old)));
    expect(style?.hookDefaults.reel?.hook[0].id).toBe('map');
  });

  it('keeps the factory for a block the file does not carry', () => {
    const { file } = houseStyleFrom(styledTrip());
    const rest: Partial<typeof file.style> = { ...file.style };
    delete rest.car;
    const style = readHouseStyle({ ...file, style: rest });
    expect(style?.car).toEqual(createTripDoc('', '', '2000-01-01', '2000-01-01').car);
    expect(style?.badgeWords).toEqual(FRENCH_BADGE_WORDS);
  });

  it('dresses a new trip, and only its look', () => {
    const style = houseStyleFrom(styledTrip()).file.style;
    const doc = createTripDoc('Islande', 'Iceland', '2026-06-01', '2026-06-12');
    const dressed = applyHouseStyle(doc, style);
    expect(dressed).toMatchObject({ id: doc.id, name: 'Islande', startDate: '2026-06-01' });
    expect(dressed.theme?.presetId).toBe('or-cine');
    expect(dressed.hookDefaults.reel?.hook[0].id).toBe('scrub');
    // A copy: composing in the new trip must not rewrite the style it came from.
    dressed.badgeWords.day = 'Tag';
    expect(style.badgeWords.day).not.toBe('Tag');
    expect(applyHouseStyle(doc, null)).toBe(doc);
  });

  it('reads the committed file, when there is one', () => {
    const found = import.meta.glob<unknown>('./house-style.json', { eager: true, import: 'default' });
    for (const raw of Object.values(found)) expect(readHouseStyle(raw)).not.toBeNull();
  });
});
