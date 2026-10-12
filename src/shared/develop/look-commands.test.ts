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
