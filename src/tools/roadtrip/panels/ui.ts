/**
 * The class strings the piece editor's panels share. One place, so the six
 * tabs stay one surface rather than six near-identical stylesheets — and,
 * since the foundations of 2026-09-13, thin wrappers over `shared/ui`: a
 * button here IS `Button`'s recipe, a chosen chip wears `Segmented`'s tile.
 */

import { buttonClass } from '../../../shared/ui/Button';

export const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
export const section = 'flex flex-col gap-2';
export const inputClass =
  'font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
export const smallButton = buttonClass('default', 'sm');
export const linkButton =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink';
export const dangerLink =
  'p-0 border-0 bg-transparent text-xs text-faint cursor-pointer underline underline-offset-[3px] hover:text-danger';
export const note =
  'm-0 px-3 py-2 rounded-control border border-line bg-paper text-xs text-ink-soft';

/** A row of option cards, each showing the REAL line it would draw. */
export function optionClass(selected: boolean): string {
  return `px-3 py-2 rounded-control border text-left cursor-pointer transition-colors ${
    selected ? 'border-accent bg-accent-wash' : 'border-line bg-paper hover:border-line-strong'
  }`;
}

/**
 * A compact chip that is either pressed or not — `Segmented`'s own tile, so
 * "chosen" looks the same here as in every segmented control of the suite.
 */
export function chipClass(selected: boolean): string {
  return `px-2 py-1.5 rounded-[8px] border text-center cursor-pointer text-xs transition-colors ${
    selected
      ? 'border-line bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(27,24,19,0.12)]'
      : 'border-transparent bg-paper-2 text-ink-soft hover:text-ink'
  }`;
}

/** The label column of a field row: a word at the left, the control at the right. */
export const rowLabel = 'w-[5.5rem] flex-none text-xs text-ink-soft';
