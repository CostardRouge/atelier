/**
 * The class strings the piece editor's panels share. One place, so the six
 * tabs stay one surface rather than six near-identical stylesheets.
 */

export const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
export const section = 'flex flex-col gap-2';
export const inputClass =
  'font-sans text-[0.82rem] px-2.5 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';
export const smallButton =
  'px-2.5 py-1.5 rounded-paper border border-line-strong bg-paper text-[0.74rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-default';
export const linkButton =
  'p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink';
export const dangerLink =
  'p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer underline underline-offset-[3px] hover:text-[#9a3a23]';
export const note =
  'm-0 px-2.5 py-2 rounded-paper border border-line bg-paper text-[0.76rem] text-ink-soft';

/** A row of option buttons, each showing the REAL line it would draw. */
export function optionClass(selected: boolean): string {
  return `px-2.5 py-1.5 rounded-paper border text-left cursor-pointer transition-colors ${
    selected ? 'border-accent bg-accent-wash' : 'border-line bg-paper hover:border-line-strong'
  }`;
}

/** A compact chip that is either pressed or not. */
export function chipClass(selected: boolean): string {
  return `px-2 py-1.5 rounded-paper border text-center cursor-pointer text-[0.74rem] transition-colors ${
    selected
      ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
      : 'border-line bg-paper text-ink-soft hover:border-line-strong'
  }`;
}
