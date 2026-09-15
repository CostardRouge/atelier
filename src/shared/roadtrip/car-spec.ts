/**
 * The trip's car, as a document field — what the garage edits and what the
 * Virée opener drives.
 *
 * A car is a property of the TRIP (the maintainer's call, 2026-09-15): one
 * car per journey, every piece of it drives the same one, and it travels in
 * the `.roadtrip.json` backup. A spec names a MODEL from the registry
 * (`hooks/car-registry.ts`), a body colour, a FINISH (factory gloss, or a
 * matte textured coating like Raptor) and the GEAR fitted — each a toggle,
 * modelled from the maintainer's own Prado.
 *
 * Pure and DOM-free: the reader never throws, a stored value is never
 * trusted, and a partial spec keeps what it says.
 */

export const CAR_MODEL_IDS = ['prado-j120'] as const;
export type CarModelId = (typeof CAR_MODEL_IDS)[number];

export type CarFinish = 'gloss' | 'matte';

/** Everything that can be bolted on, each a toggle. */
export interface CarGear {
  /** The tubular bar around the headlights. */
  bullBar: boolean;
  /** Two round lights on the bull bar — only drawn with it. */
  spotLights: boolean;
  /** The roof basket; the load below rides in it and is only drawn with it. */
  rack: boolean;
  /** A solar panel, on the left of the basket. */
  solar: boolean;
  /** The aluminium storage box, front right. */
  box: boolean;
  /** Three jerry cans across the rear: water, petrol, water. */
  jerryCans: boolean;
  /** The awning bag along the basket's left side. */
  awning: boolean;
  mudFlaps: boolean;
  /** The tinted visors over the door windows. */
  visors: boolean;
  /** The spare wheel on the tailgate. */
  spare: boolean;
  mirrors: boolean;
}

export const GEAR_KEYS: readonly (keyof CarGear)[] = [
  'bullBar',
  'spotLights',
  'rack',
  'solar',
  'box',
  'jerryCans',
  'awning',
  'mudFlaps',
  'visors',
  'spare',
  'mirrors',
];

/** What each toggle is called on screen, in the garage's order. */
export const GEAR_LABELS: Readonly<Record<keyof CarGear, string>> = {
  bullBar: 'bull bar',
  spotLights: 'spot lights',
  rack: 'roof basket',
  solar: 'solar panel',
  box: 'storage box',
  jerryCans: 'jerry cans',
  awning: 'awning bag',
  mudFlaps: 'mud flaps',
  visors: 'window visors',
  spare: 'spare wheel',
  mirrors: 'door mirrors',
};

export interface CarSpec {
  model: CarModelId;
  /** The body colour, `#rrggbb`. */
  color: string;
  finish: CarFinish;
  gear: CarGear;
}

export interface CarColour {
  id: string;
  name: string;
  hex: string;
  /** A preset that carries its own finish (a coating) sets it when picked. */
  finish?: CarFinish;
  /** A word about it, shown on hover. */
  note?: string;
}

/**
 * Named colours: the J120's factory range as it is remembered, by name
 * rather than by paint code (none is claimed), plus the maintainer's own two —
 * the dark green the car wore first and the Raptor black it wears now.
 */
export const CAR_COLOURS: readonly CarColour[] = [
  { id: 'ebony', name: 'Ebony black', hex: '#141416' },
  { id: 'glacier', name: 'Glacier white', hex: '#f2f1ea' },
  { id: 'silver', name: 'Silver pearl', hex: '#c3c5c8' },
  { id: 'graphite', name: 'Graphite', hex: '#5a5c60' },
  { id: 'champagne', name: 'Champagne', hex: '#b9aa8b' },
  { id: 'dark-blue', name: 'Dark blue', hex: '#1f2b46' },
  { id: 'merlot', name: 'Merlot', hex: '#5c1b21' },
  { id: 'dark-green', name: 'Dark green', hex: '#1f3b2f', note: 'The car before Raptor' },
  { id: 'raptor-black', name: 'Raptor black', hex: '#232326', finish: 'matte', note: 'A matte, textured coating' },
];

/** Every piece of gear on: the car as it was photographed. */
export const DEFAULT_GEAR: Readonly<CarGear> = {
  bullBar: true,
  spotLights: true,
  rack: true,
  solar: true,
  box: true,
  jerryCans: true,
  awning: true,
  mudFlaps: true,
  visors: true,
  spare: true,
  mirrors: true,
};

/** The maintainer's car: the Prado in Raptor black, fully geared. */
export function defaultCarSpec(): CarSpec {
  return { model: 'prado-j120', color: '#232326', finish: 'matte', gear: { ...DEFAULT_GEAR } };
}

export const DEFAULT_CAR: Readonly<CarSpec> = Object.freeze(defaultCarSpec());

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A stored spec, read defensively: an unknown model, an unreadable colour or
 * finish, a gear flag that is not a boolean, each lands on the default —
 * never a throw, and a partial spec keeps what it says.
 */
export function readCarSpec(raw: unknown): CarSpec {
  const fallback = defaultCarSpec();
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  const model = (CAR_MODEL_IDS as readonly string[]).includes(r.model as string)
    ? (r.model as CarModelId)
    : fallback.model;
  const color = typeof r.color === 'string' && HEX.test(r.color) ? r.color.toLowerCase() : fallback.color;
  const finish = r.finish === 'gloss' || r.finish === 'matte' ? r.finish : fallback.finish;
  const gearIn = r.gear && typeof r.gear === 'object' ? (r.gear as Record<string, unknown>) : {};
  const gear = { ...fallback.gear };
  for (const key of GEAR_KEYS) {
    const value = gearIn[key];
    if (typeof value === 'boolean') gear[key] = value;
  }
  return { model, color, finish, gear };
}

/**
 * The gear as it is actually drawn: the spot lights need the bar to sit on,
 * the roof load needs the basket to ride in. The stored flags are left as
 * they are, so turning the bar or the basket back on restores them.
 */
export function effectiveGear(gear: CarGear): CarGear {
  return {
    ...gear,
    spotLights: gear.bullBar && gear.spotLights,
    solar: gear.rack && gear.solar,
    box: gear.rack && gear.box,
    jerryCans: gear.rack && gear.jerryCans,
    awning: gear.rack && gear.awning,
  };
}

/** The preset a colour is, by its hex — "Custom" for any other. */
export function colourName(color: string): string {
  const hex = color.toLowerCase();
  return CAR_COLOURS.find((c) => c.hex === hex)?.name ?? 'Custom';
}

/** The gear that is on, in the garage's order, as words. */
export function gearWords(gear: CarGear): string[] {
  const shown = effectiveGear(gear);
  return GEAR_KEYS.filter((key) => shown[key]).map((key) => GEAR_LABELS[key]);
}

/** One line saying what the car is: the model, its colour and finish, its gear. */
export function describeCar(spec: CarSpec, modelName: string): string {
  const words = gearWords(spec.gear);
  return `${modelName} · ${colourName(spec.color)}, ${spec.finish} · ${words.length ? words.join(', ') : 'no gear'}`;
}
