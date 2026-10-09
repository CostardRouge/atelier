/**
 * Develop's PRESET commands (`shared/commands/`): the person's own book of
 * presets, read and applied by an agent the way the Presets section applies
 * one — a COPY of its numbers onto a picture, the picture's own material (its
 * RAW base, metered gain, camera profile) kept, and the preset's look worn
 * too when it carries one. Never followed: editing a preset later changes no
 * picture.
 *
 * Pure: the book, the roll and the writes are handed in.
 */

import { CommandError, type CommandSpec } from '../commands/registry';
import { landBaseCurve } from './base-curve';
import { DEFAULT_DEVELOP, describeDevelop, developOrNull, type DevelopPreset, type DevelopSettings } from './develop';
import type { SavedGrade } from '../lut/saved-grade';
import { isIgnored, type RollDoc, type RollGrade, type RollPicture } from './roll-types';

/**
 * A preset's numbers onto a picture's develop, as the Presets section's
 * `setDraft` lands them: everything the preset says, over "as shot", with the
 * picture's material kept and its base curve kept unless the preset chose one.
 */
export function presetOnto(current: DevelopSettings | null | undefined, preset: DevelopSettings): DevelopSettings | null {
  const d = current ?? DEFAULT_DEVELOP;
  return developOrNull({
    ...DEFAULT_DEVELOP,
    ...preset,
    base: d.base ?? null,
    rawGain: d.rawGain ?? null,
    rawProfile: d.rawProfile ?? null,
    baseCurve: landBaseCurve(preset.baseCurve, d.baseCurve),
  });
}

/** A preset named by its id, or by its name (case aside), or refused with the list. */
export function findPreset(list: readonly DevelopPreset[], key: string): DevelopPreset {
  const byId = list.find((p) => p.id === key);
  if (byId) return byId;
  const byName = list.filter((p) => p.name.trim().toLowerCase() === key.trim().toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new CommandError('invalid', `${byName.length} presets are named "${key}" — name one by its id`);
  throw new CommandError(
    'invalid',
    list.length ? `no preset "${key}" — the book holds ${list.map((p) => `"${p.name}"`).join(', ')}` : 'the preset book is empty',
  );
}

export interface PresetHost {
  presets: () => Promise<readonly DevelopPreset[]>;
  save: (name: string, settings: DevelopSettings, look: SavedGrade | null) => Promise<void>;
  roll: () => RollDoc;
  /** The pictures a command names, the open one when it names none; refuses an unknown id. */
  pictures: (ids: unknown) => RollPicture[];
  /** Write each picture's develop (and look, when the preset carries one) in ONE undo step, as an agent's. */
  write: (changes: ReadonlyMap<string, { develop: DevelopSettings | null; grade?: RollGrade | null }>) => void;
}

export function presetCommands(host: PresetHost): CommandSpec[] {
  return [
    {
      id: 'develop.presets',
      title: 'List the presets',
      description: 'The person’s preset book: each preset’s id, name, what it sets, and whether it carries a look too.',
      run: async () =>
        (await host.presets()).map((p) => ({ id: p.id, name: p.name, sets: describeDevelop(p.settings), withLook: Boolean(p.look) })),
    },
    {
      id: 'develop.applyPreset',
      title: 'Apply a preset',
      description:
        'Apply a preset (by id or name) to pictures — the open one unless named, or ["all"] for every picture not ignored: its numbers replace the develop (the picture’s own RAW material kept), and its look is worn too when it carries one. One undo step.',
      params: {
        preset: { type: 'string', description: 'The preset’s id or name.' },
        pictures: { type: 'strings', description: 'Picture ids, or ["all"].', optional: true },
      },
      run: async (p) => {
        const preset = findPreset(await host.presets(), p.preset as string);
        const ids = p.pictures as string[] | undefined;
        const targets =
          ids && ids.length === 1 && ids[0] === 'all' ? host.roll().pictures.filter((x) => !isIgnored(x)) : host.pictures(ids);
        const changes = new Map<string, { develop: DevelopSettings | null; grade?: RollGrade | null }>();
        for (const t of targets) {
          changes.set(t.id, { develop: presetOnto(t.develop, preset.settings), ...(preset.look ? { grade: preset.look as RollGrade } : {}) });
        }
        host.write(changes);
        return { preset: preset.name, pictures: targets.map((t) => t.id), withLook: Boolean(preset.look) };
      },
    },
    {
      id: 'develop.savePreset',
      title: 'Save a preset',
      description: 'Save a picture’s develop (the open one unless named) into the preset book under a name — with its look when withLook is true.',
      params: {
        name: { type: 'string', description: 'The preset’s name.' },
        withLook: { type: 'boolean', description: 'Carry the picture’s look too.', optional: true },
        picture: { type: 'string', description: 'A picture id; the open picture when absent.', optional: true },
      },
      run: async (p) => {
        const name = (p.name as string).trim();
        if (!name) throw new CommandError('invalid', 'a preset needs a name');
        const [picture] = host.pictures(p.picture === undefined ? undefined : [p.picture]);
        if (!picture.develop) throw new CommandError('invalid', 'that picture is as shot — there is nothing to save');
        await host.save(name, picture.develop, p.withLook === true ? ((picture.grade ?? null) as SavedGrade | null) : null);
        return { saved: name };
      },
    },
  ];
}
