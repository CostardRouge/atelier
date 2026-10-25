/**
 * What the A/B's LEFT side shows (`docs/slider-peek.md` §8, his pick B of the
 * lab https://claude.ai/artifact/FGvZdymzfXqYvjb2QnEtD7, 2026-10-25): the
 * picture as shot, as always — or the picture's own develop WITHOUT one
 * section or one slider, to see side by side what it brings.
 *
 * The choice is made on the before label and HELD above the keyed workbench
 * like the divider, so it stays across pictures. On a picture where nothing
 * of it is set, the left side is as shot again — and the choice waits for
 * the next picture that has it.
 *
 * Without is a VIEW: the record is untouched; the before half renders the
 * develop with those fields at their default (`park`, whose parked part no
 * renderer reads). The material (a RAW's base, gain, profile, white balance)
 * is never offered: it is which bytes the picture is, not a setting.
 *
 * Pure and DOM-free.
 */

import type { Dispatch, SetStateAction } from 'react';
import { DEVELOP_KEYS, type DevelopKey, type DevelopSettings, type ParkableKey } from './develop';
import { GROUP_TITLES, groupKeys, isLive, park, parkableTitle, type DevelopGroupId } from './parked';

/** As shot, a section (`g:`) or a slider (`k:`). */
export type SplitBefore = 'shot' | `g:${DevelopGroupId}` | `k:${DevelopKey}`;

/** The sections the left side can go without — every fold of numbers but the RAW's white balance. */
const BEFORE_GROUPS: readonly DevelopGroupId[] = ['light', 'tone', 'colour', 'curve', 'levels', 'mixer', 'mono', 'grading'];

/** The choice, held by the host ABOVE the workbench it keys per picture — the divider's way. */
export type BeforeHold = readonly [SplitBefore, Dispatch<SetStateAction<SplitBefore>>];

/** The fields a choice leaves out; none for as shot. */
export function beforeKeys(choice: SplitBefore): readonly ParkableKey[] {
  if (choice === 'shot') return [];
  return choice.startsWith('g:') ? groupKeys(choice.slice(2) as DevelopGroupId) : [choice.slice(2) as DevelopKey];
}

/** The choice as THIS picture can honour it: as shot when nothing of it is set here. */
export function effectiveBefore(d: DevelopSettings | null | undefined, choice: SplitBefore): SplitBefore {
  if (choice === 'shot') return 'shot';
  return beforeKeys(choice).some((k) => isLive(d, k)) ? choice : 'shot';
}

/** The develop the left side renders; null is the picture as shot. */
export function beforeDevelop(d: DevelopSettings | null | undefined, choice: SplitBefore): DevelopSettings | null {
  const shown = effectiveBefore(d, choice);
  return shown === 'shot' || !d ? null : park(d, beforeKeys(shown));
}

/** What the before label says. */
export function beforeLabel(choice: SplitBefore): string {
  if (choice === 'shot') return 'before';
  return choice.startsWith('g:')
    ? `without ${GROUP_TITLES[choice.slice(2) as DevelopGroupId]}`
    : `without ${parkableTitle(choice.slice(2) as DevelopKey)}`;
}

/** One line of the before label's menu. */
export interface BeforeChoice {
  id: SplitBefore;
  label: string;
}

/**
 * What the menu offers on this picture: As shot first, then each section with
 * something set, then each slider that is set — only what would change the
 * left side.
 */
export function beforeChoices(d: DevelopSettings | null | undefined): BeforeChoice[] {
  const out: BeforeChoice[] = [{ id: 'shot', label: 'As shot' }];
  for (const g of BEFORE_GROUPS) {
    if (groupKeys(g).some((k) => isLive(d, k))) out.push({ id: `g:${g}`, label: `Without ${GROUP_TITLES[g]}` });
  }
  for (const k of DEVELOP_KEYS) {
    if (isLive(d, k)) out.push({ id: `k:${k}`, label: `Without ${parkableTitle(k)}` });
  }
  return out;
}
