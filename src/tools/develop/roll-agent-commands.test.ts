import { describe, expect, it } from 'vitest';
import { addPictures, createRollDoc, type RollDoc } from '../../shared/develop/roll-types';
import { rollAgentCommands, type RollAgentHost } from './roll-agent-commands';

function host(over: Partial<RollAgentHost> = {}) {
  let roll: RollDoc = addPictures(createRollDoc('Test'), [
    { name: 'A.jpg', size: 1, lastModified: 1 },
    { name: 'B.jpg', size: 1, lastModified: 1 },
  ]);
  const h: RollAgentHost = {
    roll: () => roll,
    openId: () => roll.pictures[0].id,
    update: (change) => {
      roll = change(roll);
    },
    openPicture: () => {},
    thumb: async () => null,
    winnow: () => ({ client: null, connection: null }),
    presets: async () => [],
    exportLocked: () => true,
    ...over,
  };
  const specs = rollAgentCommands(h);
  const run = (id: string, params: Record<string, unknown> = {}) => specs.find((s) => s.id === id)!.run(params);
  const availability = (id: string) => specs.find((s) => s.id === id)!.available?.() ?? true;
  return { run, availability, current: () => roll };
}

describe('rollAgentCommands', () => {
  it('lists the delivery presets, writes one through the roll’s export settings, and is locked while an export runs', async () => {
    const h = host();
    expect(((await run_(h, 'develop.deliveryPreset')) as { presets: { id: string }[] }).presets.map((x) => x.id)).toContain('instagram');
    const got = (await run_(h, 'develop.deliveryPreset', { preset: 'Instagram feed' })) as { preset: string; targets: { size: unknown }[] };
    expect(got.preset).toBe('instagram-feed');
    expect(h.current().export?.targets).toEqual(got.targets);
    expect(host({ exportLocked: () => 'locked' }).availability('develop.deliveryPreset')).toBe('locked');
  });

  it('explains an untouched picture as nothing done', async () => {
    const got = (await run_(host(), 'develop.explain')) as { summary: string; steps: unknown[] };
    expect(got.summary).toBe('nothing done yet');
    expect(got.steps).toEqual([]);
  });

  it('refuses a harmonise that names only the reference, and a compare of one picture', async () => {
    const h = host();
    const a = h.current().pictures[0].id;
    await expect(run_(h, 'develop.match', { to: [a] })).rejects.toThrow(/nothing to harmonise/);
    await expect(run_(h, 'develop.compare', { pictures: [a] })).rejects.toThrow(/exactly two/);
  });

  it('needs a Winnow for a develop by rule', () => {
    expect(host().availability('develop.applyRules')).toMatch(/no Winnow/);
  });
});

function run_(h: ReturnType<typeof host>, id: string, params: Record<string, unknown> = {}) {
  return Promise.resolve(h.run(id, params));
}
