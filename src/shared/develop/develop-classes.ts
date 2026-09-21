/** The workbench's small text classes, shared by the modal, its sections and the tool. */

export const developLegendClass = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
export const developPillClass =
  'inline-flex items-center h-[1.4rem] px-2 rounded-full border border-line-strong font-mono text-3xs tracking-[0.12em] uppercase text-muted whitespace-nowrap';
/**
 * The same pill at a finger's height (32px, the zoom pill's own) for a BUTTON
 * in a phone's toolbar — a 22px chip is a caption, not a target. A separate
 * recipe rather than a second `h-*` appended to the first: two utilities of
 * one property resolve by Tailwind's order, not the class list's (`frontend.md`).
 */
export const developTouchPillClass =
  'inline-flex items-center h-8 px-3 rounded-full border border-line-strong font-mono text-3xs tracking-[0.12em] uppercase text-muted whitespace-nowrap';
export const developButtonClass =
  'px-3 py-[0.4rem] rounded-full border border-line-strong bg-paper text-xs font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-default';
export const developLinkClass =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink disabled:opacity-50 disabled:cursor-default disabled:no-underline';
