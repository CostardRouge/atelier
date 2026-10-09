/**
 * The trip's car, as a document field — what the garage edits and what the
 * Virée opener drives.
 *
 * A car is a property of the TRIP (the maintainer's call, 2026-09-15): one
 * car per journey, every piece of it drives the same one, and it travels in
 * the `.roadtrip.json` backup. A spec names a MODEL from the registry
 * (`hooks/car-registry.ts`), a body colour, a FINISH (factory gloss, or a
 * matte textured coating like Raptor) and the GEAR fitted — each a toggle.
 *
 * The gear is ONE vocabulary shared by every model, and each model offers its
 * own part of it (`CarLine.gear`): the Prado's bull bar and basket, the
 * Kadjar's rails and roof bars, the Trafic's panel glued on its roof, the
 * mirrors all have. A flag a model does not
 * offer is carried and ignored, so switching models never has to rewrite the
 * other's; every reader asks the model which flags it means.
 *
 * A "car" here is whatever the Virée drives, and since 2026-09-29 that
 * includes four BOATS — the Whitsundays day cruiser, the Viper, the Alison
 * Maree, the Solar Whisper — which offer no gear and wear their hull colour as the body's. A
 * trip may drive one, but a piece usually borrows one for a day on the water
 * (`vehicleFor`). Since 2026-10-09 two of the boats are FERRIES — the Spirit
 * of Tasmania and the Mediterranean ferry — which CARRY a vehicle
 * (`CarLine.carries`): a piece that crosses on one shows the trip's car
 * driving aboard (`DriveOptions.boarding`).
 *
 * Pure and DOM-free: the reader never throws, a stored value is never
 * trusted, and a partial spec keeps what it says.
 */

export const CAR_MODEL_IDS = [
  'prado-j120',
  'kadjar-ph2',
  'trafic-ph2',
  'zoe-ph2',
  'whitsunday-cruiser',
  'viper-jet',
  'alison-maree',
  'solar-whisper',
  'spirit-of-tasmania',
  'med-ferry',
] as const;
export type CarModelId = (typeof CAR_MODEL_IDS)[number];

/** The car a trip drives when nothing says otherwise — the maintainer's own. */
export const DEFAULT_MODEL: CarModelId = 'prado-j120';

export type CarFinish = 'gloss' | 'matte';

/** Everything that can be bolted on, each a toggle; each model offers a part of it. */
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
  /** The two rails along the roof's edges, as the factory fits them. */
  roofRails: boolean;
  /** Two bars ACROSS the roof — on the rails when they are fitted, on feet of their own otherwise. */
  roofBars: boolean;
  /** A solar panel in a frame on the roof itself — a van's, needing no basket. */
  roofSolar: boolean;
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
  'roofRails',
  'roofBars',
  'roofSolar',
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
  roofRails: 'roof rails',
  roofBars: 'roof bars',
  roofSolar: 'solar panel',
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
  /** A word about it, shown after its name — written to follow a dash. */
  note?: string;
}

/** What a model offers, and how it comes. */
export interface CarLine {
  /** The gear the garage offers on it, in the garage's order. */
  gear: readonly (keyof CarGear)[];
  /** Its named colours. */
  colours: readonly CarColour[];
  /** The car as it comes: its colour, its finish and the gear fitted. */
  color: string;
  finish: CarFinish;
  fitted: readonly (keyof CarGear)[];
  /** One sentence naming that car, for the verb that goes back to it. */
  asItComes: string;
  /** A ferry: it carries vehicles, so the trip's car can drive aboard it. */
  carries?: boolean;
}

const PRADO_GEAR: readonly (keyof CarGear)[] = [
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

/**
 * Every model the document can name. The colours are each car's factory range
 * as it is remembered, by name rather than by paint code (none is claimed),
 * plus the maintainer's own: the Prado's dark green and Raptor black, the
 * Kadjar's navy — which is his word for it, not Renault's — the Trafic's
 * white, the colour it was photographed in, and the Zoé's, "classic" white.
 */
export const CAR_LINES: Readonly<Record<CarModelId, CarLine>> = {
  'prado-j120': {
    gear: PRADO_GEAR,
    colours: [
      { id: 'ebony', name: 'Ebony black', hex: '#141416' },
      { id: 'glacier', name: 'Glacier white', hex: '#f2f1ea' },
      { id: 'silver', name: 'Silver pearl', hex: '#c3c5c8' },
      { id: 'graphite', name: 'Graphite', hex: '#5a5c60' },
      { id: 'champagne', name: 'Champagne', hex: '#b9aa8b' },
      { id: 'dark-blue', name: 'Dark blue', hex: '#1f2b46' },
      { id: 'merlot', name: 'Merlot', hex: '#5c1b21' },
      { id: 'dark-green', name: 'Dark green', hex: '#1f3b2f', note: 'the car before Raptor' },
      { id: 'raptor-black', name: 'Raptor black', hex: '#232326', finish: 'matte', note: 'a matte, textured coating' },
    ],
    color: '#232326',
    finish: 'matte',
    fitted: PRADO_GEAR,
    asItComes: 'The Prado as it was photographed: Raptor black, matte, everything fitted',
  },
  'kadjar-ph2': {
    gear: ['roofRails', 'roofBars', 'mirrors'],
    colours: [
      { id: 'navy', name: 'Navy blue', hex: '#1d2f5e', note: 'bleu marine' },
      { id: 'iron-blue', name: 'Iron blue', hex: '#3e4c5e', note: 'Bleu Iron' },
      { id: 'glacier', name: 'Glacier white', hex: '#eeeeea', note: 'Blanc Glacier' },
      { id: 'pearl', name: 'Pearl white', hex: '#e9e5da', note: 'Blanc Nacré' },
      { id: 'platinum', name: 'Platinum grey', hex: '#b2b5b8', note: 'Gris Platine' },
      { id: 'titanium', name: 'Titanium grey', hex: '#696c70', note: 'Gris Titanium' },
      { id: 'star-black', name: 'Star black', hex: '#16171a', note: 'Noir Étoilé' },
      { id: 'flame-red', name: 'Flame red', hex: '#a3161d', note: 'Rouge Flamme' },
    ],
    color: '#1d2f5e',
    finish: 'gloss',
    fitted: ['roofBars', 'mirrors'],
    asItComes: 'The Kadjar in navy blue, gloss, with its two roof bars',
  },
  'trafic-ph2': {
    gear: ['roofSolar', 'mirrors'],
    colours: [
      { id: 'glacier', name: 'Glacier white', hex: '#f0f0ec', note: 'Blanc Glacier — the van as photographed' },
      { id: 'platinum', name: 'Platinum grey', hex: '#b2b5b8', note: 'Gris Platine' },
      { id: 'comet', name: 'Comet grey', hex: '#6f7378', note: 'Gris Comète' },
      { id: 'star-black', name: 'Star black', hex: '#16171a', note: 'Noir Étoilé' },
      { id: 'panorama', name: 'Panorama blue', hex: '#2c4f86', note: 'Bleu Panorama' },
      { id: 'cumulus', name: 'Cumulus blue', hex: '#1f2e52', note: 'Bleu Cumulus' },
      { id: 'carmine', name: 'Carmine red', hex: '#9b1b22', note: 'Rouge Carmin' },
    ],
    color: '#f0f0ec',
    finish: 'gloss',
    fitted: ['roofSolar', 'mirrors'],
    asItComes: 'The Trafic in white, gloss, with the 430 W panel on its roof',
  },
  'zoe-ph2': {
    gear: ['mirrors'],
    colours: [
      { id: 'glacier', name: 'Glacier white', hex: '#f1f1ed', note: 'Blanc Glacier — the classic one' },
      { id: 'quartz', name: 'Quartz white', hex: '#e8e7e1', note: 'Blanc Quartz' },
      { id: 'highland', name: 'Highland grey', hex: '#8f9398', note: 'Gris Highland' },
      { id: 'titanium', name: 'Titanium grey', hex: '#696c70', note: 'Gris Titanium' },
      { id: 'star-black', name: 'Star black', hex: '#16171a', note: 'Noir Étoilé' },
      { id: 'celadon', name: 'Celadon blue', hex: '#5a8fb0', note: 'Bleu Céladon' },
      { id: 'berlin', name: 'Berlin blue', hex: '#1f3d6e', note: 'Bleu Berlin' },
      { id: 'flame-red', name: 'Flame red', hex: '#a3161d', note: 'Rouge Flamme' },
    ],
    color: '#f1f1ed',
    finish: 'gloss',
    fitted: ['mirrors'],
    asItComes: 'The Zoé in white, gloss, as it comes',
  },
  // The boats' liveries are guesses: none of their operators says what colour
  // they are, so each comes in the colour a boat of its kind most often wears.
  'whitsunday-cruiser': {
    gear: [],
    colours: [
      { id: 'white', name: 'White', hex: '#f4f4f1', note: 'what the day fleet mostly wears' },
      { id: 'sand', name: 'Sand', hex: '#e6d9bd' },
      { id: 'navy', name: 'Navy', hex: '#1d2f5e' },
      { id: 'charcoal', name: 'Charcoal', hex: '#34373b' },
    ],
    color: '#f4f4f1',
    finish: 'gloss',
    fitted: [],
    asItComes: 'The day cruiser in white, with its teal line',
  },
  'viper-jet': {
    gear: [],
    colours: [
      { id: 'black', name: 'Black', hex: '#1d1f23', note: 'a guess — repaint it to what it wears' },
      { id: 'white', name: 'White', hex: '#f2f2ee' },
      { id: 'grey', name: 'Grey', hex: '#6b6f75' },
      { id: 'red', name: 'Red', hex: '#b3261e' },
      { id: 'yellow', name: 'Yellow', hex: '#f0bf2c' },
    ],
    color: '#1d1f23',
    finish: 'gloss',
    fitted: [],
    asItComes: 'The Viper in black, with a red line',
  },
  'alison-maree': {
    gear: [],
    colours: [
      { id: 'white', name: 'White', hex: '#f3f4f2', note: 'a guess — repaint it to what it wears' },
      { id: 'navy', name: 'Navy', hex: '#1d2f5e' },
      { id: 'grey', name: 'Grey', hex: '#8a8f95' },
    ],
    color: '#f3f4f2',
    finish: 'gloss',
    fitted: [],
    asItComes: 'The Alison Maree in white, with its navy line',
  },
  'solar-whisper': {
    gear: [],
    colours: [
      { id: 'white', name: 'White', hex: '#f3f3ef', note: 'a guess — repaint it to what it wears' },
      { id: 'rainforest', name: 'Rainforest green', hex: '#2f5b3c' },
      { id: 'sand', name: 'Sand', hex: '#e2d6bb' },
      { id: 'navy', name: 'Navy', hex: '#1d2f5e' },
    ],
    color: '#f3f3ef',
    finish: 'gloss',
    fitted: [],
    asItComes: 'The Solar Whisper in white, its roof tiled with solar panels',
  },
  // The ferries. The Spirit's red is the operator's own word for its brand;
  // the Mediterranean ferry is no one ship, painted like the one at Tanger Med.
  'spirit-of-tasmania': {
    gear: [],
    colours: [
      { id: 'white', name: 'White', hex: '#f4f4f1', note: 'with the red band and funnel the operator calls its brand' },
      { id: 'grey', name: 'Light grey', hex: '#d9dcde' },
      { id: 'navy', name: 'Navy', hex: '#1d2a4a' },
    ],
    color: '#f4f4f1',
    finish: 'gloss',
    fitted: [],
    asItComes: 'The Spirit of Tasmania in white, its band and funnel red',
    carries: true,
  },
  'med-ferry': {
    gear: [],
    colours: [
      { id: 'navy', name: 'Navy', hex: '#1d2a4a', note: 'like the ship at Tanger Med — a guess, repaint it to the one you took' },
      { id: 'white', name: 'White', hex: '#f3f4f2', note: 'as many Spanish and Italian ferries wear it' },
      { id: 'royal', name: 'Royal blue', hex: '#1f4e9a' },
      { id: 'red', name: 'Red', hex: '#a8262b' },
    ],
    color: '#1d2a4a',
    finish: 'gloss',
    fitted: [],
    asItComes: 'The Mediterranean ferry with a navy hull, its funnels banded white',
    carries: true,
  },
};

/** Whether a model is a ferry, which the trip's car can drive aboard. */
export function carriesVehicles(model: string): boolean {
  return carLine(model).carries === true;
}

/** What a model offers — the Prado's for an id this build does not know. */
export function carLine(model: string): CarLine {
  return (CAR_LINES as Record<string, CarLine | undefined>)[model] ?? CAR_LINES[DEFAULT_MODEL];
}

function isModelId(value: unknown): value is CarModelId {
  return (CAR_MODEL_IDS as readonly unknown[]).includes(value);
}

/** Every flag off but the ones named. */
function gearWith(fitted: readonly (keyof CarGear)[]): CarGear {
  const gear = Object.fromEntries(GEAR_KEYS.map((key) => [key, false])) as unknown as CarGear;
  for (const key of fitted) gear[key] = true;
  return gear;
}

/** The Prado's gear as it was photographed: everything it offers, on. */
export const DEFAULT_GEAR: Readonly<CarGear> = Object.freeze(gearWith(CAR_LINES[DEFAULT_MODEL].fitted));

/** A model as it comes — by default the maintainer's car, the Prado in Raptor black, fully geared. */
export function defaultCarSpec(model: CarModelId = DEFAULT_MODEL): CarSpec {
  const line = CAR_LINES[model];
  return { model, color: line.color, finish: line.finish, gear: gearWith(line.fitted) };
}

export const DEFAULT_CAR: Readonly<CarSpec> = Object.freeze(defaultCarSpec());

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A stored spec, read defensively: an unknown model lands on the default car,
 * and an unreadable colour or finish, or a gear flag that is not a boolean,
 * on what ITS model comes with — never a throw, and a partial spec keeps what
 * it says.
 */
export function readCarSpec(raw: unknown): CarSpec {
  if (!raw || typeof raw !== 'object') return defaultCarSpec();
  const r = raw as Record<string, unknown>;
  const model = isModelId(r.model) ? r.model : DEFAULT_MODEL;
  const fallback = defaultCarSpec(model);
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
 * they are, so turning the bar or the basket back on restores them. The roof
 * bars need nothing: without the rails they stand on feet of their own.
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

/** Whether two specs describe the same car, flag by flag — the flags its model offers. */
export function sameCarSpec(a: CarSpec, b: CarSpec): boolean {
  return (
    a.model === b.model &&
    a.color.toLowerCase() === b.color.toLowerCase() &&
    a.finish === b.finish &&
    carLine(a.model).gear.every((key) => a.gear[key] === b.gear[key])
  );
}

/** The model's preset a colour is, by its hex — "Custom" for any other. */
export function colourName(color: string, model: string): string {
  const hex = color.toLowerCase();
  return carLine(model).colours.find((c) => c.hex === hex)?.name ?? 'Custom';
}

/** The gear that is on and drawn on this model, in the garage's order, as words. */
export function gearWords(gear: CarGear, model: string): string[] {
  const shown = effectiveGear(gear);
  return carLine(model).gear.filter((key) => shown[key]).map((key) => GEAR_LABELS[key]);
}

/** One line saying what the car is: the model, its colour and finish, its gear — if it offers any. */
export function describeCar(spec: CarSpec, modelName: string): string {
  const head = `${modelName} · ${colourName(spec.color, spec.model)}, ${spec.finish}`;
  if (carLine(spec.model).gear.length === 0) return head;
  const words = gearWords(spec.gear, spec.model);
  return `${head} · ${words.length ? words.join(', ') : 'no gear'}`;
}

/** What a piece's Virée drives: its own pick if it made one. */
export type VehicleChoice = 'trip' | CarModelId;
export const VEHICLE_CHOICES: readonly VehicleChoice[] = ['trip', ...CAR_MODEL_IDS];

/**
 * The vehicle a PIECE drives. The trip has one car (`TripDoc.car`), but a day
 * on the water borrows a boat: `choice` names the model the piece picked,
 * `color` its own paint (empty: as it comes). The trip's car stands for itself
 * — as it is dressed in the garage — whether the piece left the choice to the
 * trip or picked that very model.
 */
export function vehicleFor(choice: string, color: string, tripCar: CarSpec): CarSpec {
  if (!isModelId(choice) || choice === tripCar.model) return tripCar;
  const spec = defaultCarSpec(choice);
  return HEX.test(color) ? { ...spec, color: color.toLowerCase() } : spec;
}
