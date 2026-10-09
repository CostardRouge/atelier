import { describe, expect, it } from 'vitest';
import { ALISON_LENGTH, ALISON_WIDTH, buildAlisonMaree } from './alison-maree-model';
import { hullPart } from './boat-parts';
import { VEHICLE_MODELS } from './vehicle-registry';
import { faceNormal, renderOrder, type Part } from './mesh3d';
import { WHISPER_LENGTH, WHISPER_WIDTH, buildSolarWhisper } from './solar-whisper-model';
import { VIPER_LENGTH, VIPER_WIDTH, buildViper } from './viper-model';
import { CRUISER_LENGTH, CRUISER_WIDTH, buildCruiser } from './whitsunday-cruiser-model';
import { SPIRIT_LENGTH, SPIRIT_WIDTH, buildSpiritOfTasmania, spiritRamps } from './spirit-of-tasmania-model';
import { MED_FERRY_LENGTH, MED_FERRY_WIDTH, buildMedFerry, medFerryRamps } from './med-ferry-model';
import { carriesVehicles } from '../vehicle-spec';

const verts = (parts: Part[]) => parts.flatMap((p) => p.faces.flatMap((f) => [...f.verts]));
const extent = (parts: Part[], axis: 0 | 1 | 2) => {
  const vs = verts(parts).map((v) => v[axis]);
  return { min: Math.min(...vs), max: Math.max(...vs) };
};
const ids = (parts: Part[]) => parts.map((p) => p.id);

const BOATS = [
  { name: 'the Whitsundays day cruiser', parts: buildCruiser(), length: CRUISER_LENGTH, width: CRUISER_WIDTH },
  { name: 'the Viper', parts: buildViper(), length: VIPER_LENGTH, width: VIPER_WIDTH },
  { name: 'the Alison Maree', parts: buildAlisonMaree(), length: ALISON_LENGTH, width: ALISON_WIDTH },
  { name: 'the Solar Whisper', parts: buildSolarWhisper(), length: WHISPER_LENGTH, width: WHISPER_WIDTH },
  { name: 'the Spirit of Tasmania', parts: buildSpiritOfTasmania(), length: SPIRIT_LENGTH, width: SPIRIT_WIDTH },
  { name: 'the Mediterranean ferry', parts: buildMedFerry(), length: MED_FERRY_LENGTH, width: MED_FERRY_WIDTH },
];

describe.each(BOATS)('$name', ({ parts, length, width }) => {
  it('floats: nothing under the waterline, and the waterline itself never built', () => {
    expect(extent(parts, 2).min).toBeGreaterThanOrEqual(-1e-9);
    for (const part of parts) {
      for (const face of part.faces) {
        const n = faceNormal(face.verts);
        const z = Math.max(...face.verts.map((v) => v[2]));
        if (n[2] < -0.9) expect(z, `${part.id} shows a face down at the water`).toBeGreaterThan(0.1);
      }
    }
  });

  it('keeps to its stated length and beam', () => {
    const y = extent(parts, 1);
    expect(y.max - y.min).toBeGreaterThanOrEqual(length - 1e-6);
    expect(y.max - y.min).toBeLessThan(length + 0.5);
    const x = extent(parts, 0);
    expect(x.max - x.min).toBeCloseTo(width, 1);
  });

  it('is a few dozen parts with unique ids, and shows its deck from above', () => {
    expect(parts.length).toBeGreaterThan(20);
    expect(new Set(ids(parts)).size).toBe(parts.length);
    const top = renderOrder(parts, { fx: 0, fy: 1, tilt: Math.PI / 2 - 0.2, scale: 10, x: 0, y: 0 });
    expect(top.some((f) => f.role === 'deck' || f.role === 'deckUpper')).toBe(true);
  });
});

describe('the catamarans', () => {
  it('stand on two hulls, each cut where the bridge deck ends, only the bows showing a deck', () => {
    for (const parts of [buildCruiser(), buildAlisonMaree()]) {
      for (const side of ['l', 'r']) {
        const aft = parts.find((p) => p.id === `hull-${side}-aft`)!;
        const bow = parts.find((p) => p.id === `hull-${side}-bow`)!;
        expect(aft.faces.some((f) => f.role === 'deck')).toBe(false);
        expect(bow.faces.some((f) => f.role === 'deck')).toBe(true);
      }
    }
  });

  it('tell each other apart: a shaded upper deck on the day boat, a glass wheelhouse on the whale-watcher', () => {
    const cruiser = buildCruiser();
    const alison = buildAlisonMaree();
    expect(ids(cruiser).some((id) => id.startsWith('canopy'))).toBe(true);
    expect(ids(alison).some((id) => id.startsWith('canopy'))).toBe(false);
    const glassWalls = (parts: Part[]) => parts.find((p) => p.id === 'wheelhouse')!.faces.filter((f) => f.role === 'glassDark').length;
    expect(glassWalls(alison)).toBeGreaterThanOrEqual(3);
    expect(glassWalls(cruiser)).toBe(1);
    // Whale-watching wants a big open upper deck: it reaches further aft.
    const upperAft = (parts: Part[]) => extent([parts.find((p) => p.id === 'upper-aft')!], 1).min;
    expect(upperAft(alison) / ALISON_LENGTH).toBeLessThan(upperAft(cruiser) / CRUISER_LENGTH);
  });
});

describe('the Viper', () => {
  const viper = buildViper();

  it('seats 36: six rows of benches for three, either side of an aisle', () => {
    const seats = viper.filter((p) => p.id.startsWith('seat-'));
    expect(seats).toHaveLength(12);
    expect(seats.filter((p) => p.centre[0] < 0)).toHaveLength(6);
  });

  it('runs on two jets at the transom, not outboards, with its helm ahead of the benches', () => {
    const jets = viper.filter((p) => p.id.startsWith('jet-'));
    expect(jets).toHaveLength(2);
    const stern = extent([viper.find((p) => p.id === 'hull')!], 1).min;
    for (const jet of jets) expect(jet.centre[1]).toBeLessThan(stern);
    const helm = viper.find((p) => p.id === 'console')!;
    for (const seat of viper.filter((p) => p.id.startsWith('seat-'))) expect(helm.centre[1]).toBeGreaterThan(seat.centre[1]);
  });
});

describe('the Solar Whisper', () => {
  const whisper = buildSolarWhisper();

  it('is a longboat, long and narrow, low on the river', () => {
    expect(WHISPER_LENGTH / WHISPER_WIDTH).toBeGreaterThan(3);
    const hull = whisper.find((p) => p.id === 'hull')!;
    expect(extent([hull], 2).max).toBeLessThan(1);
  });

  it('seats its guests along both edges, backs to the water, in bays between the roof’s posts', () => {
    const benches = whisper.filter((p) => p.id.startsWith('bench-'));
    expect(benches).toHaveLength(6);
    for (const b of benches) expect(Math.abs(extent([b], 0).max) === 1.3 || Math.abs(extent([b], 0).min) === 1.3).toBe(true);
    const posts = whisper.filter((p) => p.id.startsWith('post-'));
    expect(posts).toHaveLength(8);
  });

  it('carries its solar panels on a roof flush with its corner posts, and its croc cam under the front edge', () => {
    expect(whisper.filter((p) => p.id.startsWith('solar-')).length).toBeGreaterThanOrEqual(12);
    const roof = whisper.filter((p) => p.id.startsWith('roof-'));
    const posts = whisper.filter((p) => p.id.startsWith('post-'));
    expect(extent(roof, 1).min).toBeCloseTo(extent(posts, 1).min, 9);
    expect(extent(roof, 1).max).toBeCloseTo(extent(posts, 1).max, 9);
    expect(extent(roof, 0).max).toBeCloseTo(extent(posts, 0).max, 9);
    const cam = whisper.find((p) => p.id === 'croc-cam')!;
    expect(extent([cam], 2).max).toBeCloseTo(extent(roof, 2).min, 9);
  });

  it('runs on two electric outboards at the transom, and throws the faintest wake of the fleet', () => {
    const stern = extent([whisper.find((p) => p.id === 'hull')!], 1).min;
    const motors = whisper.filter((p) => /^outboard-[lr]$/.test(p.id));
    expect(motors).toHaveLength(2);
    for (const m of motors) expect(m.centre[1]).toBeLessThan(stern);
    const wakes = VEHICLE_MODELS.filter((m) => m.kind === 'boat').map((m) => [m.id, m.wake ?? 1] as const);
    const least = wakes.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(least[0]).toBe('solar-whisper');
  });
});

describe('hullPart', () => {
  it('is six flat faces with the waterline left out: a deck, two flared sides, two bow faces, a transom', () => {
    const hull = hullPart('h', { cx: 0, stern: -5, bow: 5, forefoot: 4, taper: 1, deckHalf: 1.5, waterHalf: 1, freeboard: 1 });
    expect(hull.faces).toHaveLength(6);
    expect(hull.faces.filter((f) => f.role === 'deck')).toHaveLength(1);
    for (const face of hull.faces) {
      const n = faceNormal(face.verts);
      const d = n[0] * face.verts[0][0] + n[1] * face.verts[0][1] + n[2] * face.verts[0][2];
      for (const v of face.verts) expect(Math.abs(n[0] * v[0] + n[1] * v[1] + n[2] * v[2] - d)).toBeLessThan(1e-9);
    }
  });
});

describe('the ferries', () => {
  const FERRIES = [
    { name: 'the Spirit of Tasmania', parts: buildSpiritOfTasmania(), ramps: spiritRamps(), length: SPIRIT_LENGTH },
    { name: 'the Mediterranean ferry', parts: buildMedFerry(), ramps: medFerryRamps(), length: MED_FERRY_LENGTH },
  ];

  it.each(FERRIES)('$name builds no deck under its superstructure, and keeps the aft and fore mooring decks', ({ parts }) => {
    const slices = parts.filter((p) => /^hull-\d+$/.test(p.id));
    expect(slices.length).toBeGreaterThanOrEqual(4);
    const decked = slices.filter((p) => p.faces.some((f) => f.role === 'deck')).map((p) => p.id);
    expect(decked).toEqual(['hull-0', `hull-${slices.length - 1}`]);
    // Only the first slice keeps its transom: a cut between two slices is inside the hull.
    const transoms = slices.filter((p) => p.faces.some((f) => faceNormal(f.verts)[1] < -0.9));
    expect(transoms.map((p) => p.id)).toEqual(['hull-0']);
  });

  it.each(FERRIES)('$name has its stern door on the transom, and ramps that stay above the water and out of the hull', ({ parts, ramps }) => {
    const stern = extent(parts.filter((p) => p.id === 'hull-0'), 1).min;
    const door = parts.find((p) => p.id === 'stern-door')!;
    expect(door.centre[1]).toBeLessThan(stern);
    expect(door.centre[1]).toBeGreaterThan(stern - 0.1);
    const bow = extent(parts.filter((p) => /^hull-\d+$/.test(p.id)), 1).max;
    expect(extent(ramps.stern, 1).max).toBeLessThanOrEqual(stern);
    expect(extent(ramps.stern, 1).min).toBeLessThan(stern - 10);
    expect(extent(ramps.bow, 1).max).toBeGreaterThan(bow);
    for (const ramp of [...ramps.stern, ...ramps.bow]) expect(extent([ramp], 2).min).toBeGreaterThan(0);
  });

  it('tell each other apart: one funnel on the Spirit, two side by side on the Mediterranean ferry', () => {
    const funnels = (parts: Part[]) => parts.filter((p) => /^funnel-\d+$/.test(p.id));
    expect(funnels(buildSpiritOfTasmania())).toHaveLength(1);
    const twin = funnels(buildMedFerry());
    expect(twin).toHaveLength(2);
    expect(twin[0].centre[0]).toBeCloseTo(-twin[1].centre[0], 9);
    // A long open aft deck on the Mediterranean ferry: its superstructure starts further forward.
    const aftOf = (parts: Part[], length: number) => extent([parts.find((p) => p.id === 'tier-a-0')!], 1).min / length;
    expect(aftOf(buildMedFerry(), MED_FERRY_LENGTH)).toBeGreaterThan(aftOf(buildSpiritOfTasmania(), SPIRIT_LENGTH));
  });

  it('carry vehicles, drawn bigger than a car on the map, with ramps to lower — and nothing else does', () => {
    const ferries = VEHICLE_MODELS.filter((m) => carriesVehicles(m.id)).map((m) => m.id);
    expect(ferries).toEqual(['spirit-of-tasmania', 'med-ferry']);
    for (const m of VEHICLE_MODELS) {
      const ferry = ferries.includes(m.id);
      expect(m.kind === 'boat' || !ferry).toBe(true);
      expect(!!m.ramps, m.id).toBe(ferry);
      expect((m.mapScale ?? 1) > 1, m.id).toBe(ferry);
    }
  });
});

describe('the registry', () => {
  it('lists the six boats as boats, the four cars as cars', () => {
    expect(VEHICLE_MODELS.filter((m) => m.kind === 'boat').map((m) => m.id)).toEqual([
      'whitsunday-cruiser',
      'viper-jet',
      'alison-maree',
      'solar-whisper',
      'spirit-of-tasmania',
      'med-ferry',
    ]);
    expect(VEHICLE_MODELS.filter((m) => m.kind === 'car').map((m) => m.id)).toEqual(['prado-j120', 'kadjar-ph2', 'trafic-ph2', 'zoe-ph2']);
  });
});
