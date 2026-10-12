import { describe, expect, it, vi } from 'vitest';

// `builtin-luts` reads `virtual:luts`, a Vite module a node run does not have:
// one conversion and one creative look, as the shipped folders hold them.
vi.mock('virtual:luts', () => ({
  default: [
    { id: 'dji-mini', name: 'Dji Mini 4 Pro D Log M To Rec709', group: 'dji', file: 'dji/dji_mini_4_pro_d-log_m-to-rec709.cube' },
    { id: 'classic-warm', name: 'Warm', group: 'classic', file: 'classic/warm.cube' },
  ],
}));
import { BUILTIN_LUTS } from '../lut/builtin-luts';
import { LOOK_STRENGTH } from '../lut/look-strength';
import { familyForLookName } from '../lut/lut-pack';
import type { LutStack } from '../lut/use-lut-stack';
import type { LutPackIndex } from '../lut/lut-pack';
import { lookCommands } from './look-commands';

function host() {
  const added: { kind: string; id: string; intensity: number }[] = [];
  const stack = {
    layers: [],
    output: 'none',
    busy: false,
    error: null,
    addBuiltin: async (id: string, intensity: number) => void added.push({ kind: 'builtin', id, intensity }),
    addFilm: (id: string, intensity: number) => void added.push({ kind: 'film', id, intensity }),
  } as unknown as LutStack;
  const specs = lookCommands({ stack: () => stack, available: () => true, asAgent: (w) => Promise.resolve(w()) });
  const run = (id: string, p: Record<string, unknown>) => specs.find((s) => s.id === id)!.run(p);
  return { run, added };
}

describe('develop.addLook', () => {
  const creative = BUILTIN_LUTS.find((l) => familyForLookName(l.name) === 'rec709')!;
  const conversion = BUILTIN_LUTS.find((l) => familyForLookName(l.name) === 'log')!;

  it('doses a creative look and a film stock, and lands a conversion whole, when no strength is given', async () => {
    const h = host();
    await h.run('develop.addLook', { builtin: creative.id });
    await h.run('develop.addLook', { builtin: conversion.id });
    await h.run('develop.addLook', { film: 'reversal-vivid' });
    expect(h.added.map((a) => a.intensity)).toEqual([LOOK_STRENGTH, 1, LOOK_STRENGTH]);
  });

  it('keeps the strength it is given', async () => {
    const h = host();
    await h.run('develop.addLook', { builtin: creative.id, intensity: 0.75 });
    expect(h.added[0].intensity).toBe(0.75);
  });

  it('says which built-ins are conversions', async () => {
    const got = (await host().run('develop.looks', {})) as { builtin: { id: string; conversion: boolean }[] };
    expect(got.builtin.find((l) => l.id === conversion.id)?.conversion).toBe(true);
    expect(got.builtin.find((l) => l.id === creative.id)?.conversion).toBe(false);
  });
});

describe('develop.fitLook', () => {
  /** A stack with one layer whose picture's chroma grows 0.1 per unit of strength, measured as the stage would. */
  function fitHost(intensity = 1) {
    const layer = { id: 'l1', name: 'Warm', source: 'builtin:classic-warm', intensity, enabled: true };
    const stack = {
      get layers() {
        return [layer];
      },
      output: 'none',
      busy: false,
      error: null,
      setIntensity: (_id: string, v: number) => void (layer.intensity = v),
      setEnabled: (_id: string, v: boolean) => void (layer.enabled = v),
    } as unknown as LutStack;
    const measure = async () => ({
      mean: 120, p1: 5, median: 118, p99: 240, red: 120, green: 118, blue: 116, clippedHighlights: 0, crushedShadows: 0,
      saturation: { mean: Math.round((0.2 + 0.1 * (layer.enabled ? layer.intensity : 0)) * 1000) / 1000, p95: 0.5, vivid: 0.05, gamutEdge: 0 },
    });
    const specs = lookCommands({ stack: () => stack, available: () => true, asAgent: (w) => Promise.resolve(w()), measure });
    return { run: (p: Record<string, unknown>) => specs.find((s) => s.id === 'develop.fitLook')!.run(p), layer };
  }

  it('sets the strongest strength that stays within the limits, and says why it stopped', async () => {
    const h = fitHost();
    const got = (await h.run({})) as { strength: number; applied: boolean; reason: string; measures: unknown[] };
    expect(got.strength).toBe(0.5);
    expect(got.applied).toBe(true);
    expect(h.layer.intensity).toBe(0.5);
    expect(got.reason).toMatch(/mean chroma/);
    expect(got.measures.length).toBeGreaterThan(2);
  });

  it('puts the layer back as it was when asked only to look', async () => {
    const h = fitHost(0.9);
    const got = (await h.run({ apply: false })) as { strength: number; keptAt: number };
    expect(got.strength).toBe(0.5);
    expect(got.keptAt).toBe(0.9);
    expect(h.layer.intensity).toBe(0.9);
  });
});

describe('the packs, by reference', () => {
  const pack = {
    id: 'pk_authentic',
    name: 'AUTHENTIC',
    author: 'Victor Jimenes',
    tree: [{ id: 'creative', label: 'Creative', children: [{ id: 'creative/warm', label: 'Warm' }] }, { id: 'conversion', label: 'Conversion' }],
    looks: [
      { id: 'creative/warm/golden', label: 'Golden', node: 'creative/warm', file: 'a.cube', family: 'rec709', hash: 'h1' },
      { id: 'creative/warm/goldenrod', label: 'Goldenrod', node: 'creative/warm', file: 'b.cube', family: 'rec709', hash: 'h2' },
      { id: 'conversion/slog3', label: 'S-Log3', node: 'conversion', file: 'c.cube', family: 'log', hash: 'h3' },
      { id: 'creative/hidden', label: 'Hidden', node: 'creative', file: 'd.cube', family: 'rec709', hash: 'h4' },
    ],
    hidden: ['creative/hidden'],
  } as unknown as LutPackIndex;

  function packHost() {
    const added: { ref: unknown; intensity: number }[] = [];
    const stack = { layers: [], output: 'none', busy: false, error: null, addPackLook: async (ref: unknown, _n: unknown, intensity: number) => void added.push({ ref, intensity }) } as unknown as LutStack;
    const specs = lookCommands({ stack: () => stack, available: () => true, asAgent: (w) => Promise.resolve(w()), packs: async () => [pack] });
    return { run: (id: string, p: Record<string, unknown>) => specs.find((s) => s.id === id)!.run(p), added };
  }

  it('lists a pack’s visible looks with their folders, never a lattice', async () => {
    const got = (await packHost().run('develop.looks', {})) as { packs: { id: string; looks: { id: string; name: string; conversion: boolean }[] }[] };
    expect(got.packs[0]).toMatchObject({ id: 'pk_authentic', name: 'AUTHENTIC', author: 'Victor Jimenes' });
    expect(got.packs[0].looks).toEqual([
      { id: 'creative/warm/golden', name: 'Creative · Warm · Golden', conversion: false },
      { id: 'creative/warm/goldenrod', name: 'Creative · Warm · Goldenrod', conversion: false },
      { id: 'conversion/slog3', name: 'Conversion · S-Log3', conversion: true },
    ]);
    expect(JSON.stringify(got)).not.toMatch(/\.cube|h1/);
  });

  it('adds a look by its pack’s name and its own, dosed unless it converts', async () => {
    const h = packHost();
    await h.run('develop.addLook', { pack: 'authentic', look: 'golden' });
    await h.run('develop.addLook', { pack: 'Victor Jimenes', look: 'conversion/slog3' });
    expect(h.added).toEqual([
      { ref: { pack: 'pk_authentic', look: 'creative/warm/golden', hash: 'h1' }, intensity: LOOK_STRENGTH },
      { ref: { pack: 'pk_authentic', look: 'conversion/slog3', hash: 'h3' }, intensity: 1 },
    ]);
  });

  it('refuses an ambiguous part, a hidden look and an unknown pack, naming what there is', async () => {
    const h = packHost();
    await expect(Promise.resolve(h.run('develop.addLook', { pack: 'authentic', look: 'gold' }))).rejects.toThrow(/names 2 looks/);
    await expect(Promise.resolve(h.run('develop.addLook', { pack: 'authentic', look: 'hidden' }))).rejects.toThrow(/no look "hidden"/);
    await expect(Promise.resolve(h.run('develop.addLook', { pack: 'Nope', look: 'x' }))).rejects.toThrow(/the packs are "AUTHENTIC"/);
    await expect(Promise.resolve(h.run('develop.addLook', { pack: 'authentic' }))).rejects.toThrow(/go together/);
  });
});
