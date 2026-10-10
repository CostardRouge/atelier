/**
 * The arithmetic behind Develop's COMMANDS (`shared/commands/registry.ts`,
 * registered by `DevelopTool`, `RollEditor` and `PictureWorkbench`): what an
 * agent is told about a roll and its pictures, and how a set of slider values
 * becomes the develop that is written.
 *
 * The values an agent sends are checked against the very ranges the panel
 * draws (`DEVELOP_RANGES`) and REFUSED outside them rather than clamped, like
 * every command parameter: the agent learns the range from the refusal
 * instead of believing exposure 9 was applied.
 *
 * Pure and DOM-free.
 */

import { CommandError } from '../commands/registry';
import { DEVELOP_KEYS, DEVELOP_RANGES, cloneDevelop, isDefaultDevelop, type DevelopSettings } from './develop';
import type { DevelopKey } from './develop';
import { PICTURE_SECTIONS, type PictureSection } from './picture-sections';
import {
  deliverState,
  isClipPicture,
  pictureEdits,
  pictureLabel,
  variantNumber,
  type DeliverState,
  type PictureEdit,
  type RollDoc,
  type RollPicture,
} from './roll-types';

/** One slider as an agent reads it. */
export interface DevelopControl {
  key: DevelopKey;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** "As shot" — the identity on every pixel. */
  default: 0;
  value: number;
}

/** The eleven sliders of a develop, in the panel's order, with their values. */
export function developControls(d: DevelopSettings | null | undefined): DevelopControl[] {
  return DEVELOP_KEYS.map((key) => {
    const r = DEVELOP_RANGES[key];
    return { key, min: r.min, max: r.max, step: r.step, unit: r.unit, default: 0, value: d?.[key] ?? 0 };
  });
}

/**
 * `current` with `values` written over it — slider keys only, each a finite
 * number inside its range — or null when the result is "as shot" (a document
 * stores nothing for an untouched picture). Everything the sliders do not
 * name — curves, mixer, grading, the RAW material — is kept as it was.
 */
export function withDevelopValues(current: DevelopSettings | null | undefined, values: Record<string, unknown>): DevelopSettings | null {
  const keys = Object.keys(values);
  if (keys.length === 0) throw new CommandError('invalid', `"values" is empty — give at least one of ${DEVELOP_KEYS.join(', ')}`);
  const next = cloneDevelop(current);
  for (const k of keys) {
    if (!(DEVELOP_KEYS as readonly string[]).includes(k)) {
      throw new CommandError('invalid', `"${k}" is not a slider — the sliders are ${DEVELOP_KEYS.join(', ')}`);
    }
    const key = k as DevelopKey;
    const v = values[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new CommandError('invalid', `"${k}" must be a finite number`);
    const { min, max, unit } = DEVELOP_RANGES[key];
    if (v < min || v > max) {
      throw new CommandError('invalid', `${k} ${v} is outside its range ${min}..${max}${unit ? ` ${unit}` : ''}`);
    }
    next[key] = v;
  }
  return isDefaultDevelop(next) ? null : next;
}

/** The sections a reset may clear, as their ids. */
export const SECTION_IDS: readonly PictureSection[] = PICTURE_SECTIONS.map((s) => s.id);

/** A picture as an agent lists it. */
export interface PictureSummary {
  id: string;
  /** The file's name, with ` · 2` for a variant — the name every list shows. */
  name: string;
  open: boolean;
  clip: boolean;
  variant: number;
  /** The sections that carry an edit; empty is a picture as shot. */
  edited: PictureEdit[];
  /** Whether it leaves in an export: `auto` follows "edited ones leave". */
  deliver: DeliverState;
  title: string | null;
}

export function pictureSummary(p: RollPicture, openId: string | null): PictureSummary {
  return {
    id: p.id,
    name: pictureLabel(p),
    open: p.id === openId,
    clip: isClipPicture(p),
    variant: variantNumber(p),
    edited: pictureEdits(p),
    deliver: deliverState(p),
    title: p.title?.trim() ? p.title : null,
  };
}

/** A roll as an agent lists it. */
export interface RollSummary {
  id: string;
  name: string;
  pictures: number;
  edited: number;
  updatedAt: string;
}

export function rollSummary(roll: RollDoc): RollSummary {
  return {
    id: roll.id,
    name: roll.name,
    pictures: roll.pictures.length,
    edited: roll.pictures.filter((p) => pictureEdits(p).length > 0).length,
    updatedAt: new Date(roll.updatedAt).toISOString(),
  };
}

/**
 * The picture `id` names in `roll`, or the open one when none is named — the
 * rule every Develop command follows. Throws `invalid` for an id the roll
 * does not hold, `unavailable` when nothing is named and nothing is open.
 */
export function targetPicture(roll: RollDoc, id: unknown, openId: string | null): RollPicture {
  if (typeof id === 'string') {
    const p = roll.pictures.find((x) => x.id === id);
    if (!p) throw new CommandError('invalid', `the roll holds no picture "${id}" — develop.pictures lists them`);
    return p;
  }
  const open = openId ? roll.pictures.find((x) => x.id === openId) : undefined;
  if (!open) throw new CommandError('unavailable', 'no picture is open — name one, or open one with develop.openPicture');
  return open;
}
