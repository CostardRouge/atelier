import type { ReactNode } from 'react';
import type { AutoState } from './auto-slots';

/**
 * One automatic verb drawn as a SWITCH (`auto-slots.ts`): a press applies, a
 * second takes it back. Its colours are chosen per state here and never
 * appended to another recipe's — two utilities of one property resolve by
 * Tailwind's order, not the class list's, and the lit state lost to the plain
 * button's border, ground and ink (`frontend.md`).
 */
const SHAPE = {
  /** The Adjust tab's Auto row: the workbench's pill. */
  pill: 'px-3 py-[0.4rem] rounded-full font-semibold',
  /** Beside a shared `Button size="sm"` (the Crop tab). */
  control: 'h-7 px-2.5 rounded-control font-medium',
} as const;

/**
 * Each state's colours, whole. `ground` is the shape's own (the workbench's
 * pill sits on paper, a `Button` on surface), so an unlit switch looks like
 * the buttons beside it.
 */
function look(state: AutoState | 'armed', shape: keyof typeof SHAPE): string {
  const ground = shape === 'pill' ? 'bg-paper' : 'bg-surface';
  switch (state) {
    case 'on':
      return 'border-accent bg-accent-wash text-accent-ink';
    case 'nothing':
      return `border-dashed border-line-strong ${ground} text-muted hover:text-accent-ink`;
    case 'edited':
      return `border-accent ${ground} text-ink hover:text-accent-ink`;
    case 'armed':
      return `border-accent ${ground} text-accent-ink`;
    default:
      return shape === 'pill'
        ? 'border-line-strong bg-paper text-ink-soft hover:border-accent hover:text-accent-ink'
        : 'border-line-strong bg-surface text-ink hover:bg-paper-2 hover:border-muted';
  }
}

/** What a switch says under the pointer, by its state; off says the verb's own hint. */
export const AUTO_SWITCH_TITLE: Readonly<Record<Exclude<AutoState, 'off'>, string>> = {
  on: 'On · click to put back what was there before',
  nothing: 'Changed nothing · click to clear',
  edited: 'Moved by hand since · click to put back what was there before it',
};

function Dot({ state }: { state: AutoState }) {
  if (state === 'off') return null;
  const look =
    state === 'on'
      ? 'bg-accent'
      : state === 'nothing'
        ? 'border border-dashed border-muted'
        : 'border border-accent bg-[linear-gradient(90deg,var(--color-accent)_50%,transparent_50%)]';
  return <span aria-hidden className={`inline-block w-2 h-2 rounded-full flex-none ${look}`} />;
}

export default function AutoSwitch({
  state,
  armed = false,
  shape = 'pill',
  hint,
  disabled,
  onClick,
  children,
}: {
  state: AutoState;
  /** A tool waiting for the picture (Pick grey's dropper): drawn as such, no dot. */
  armed?: boolean;
  shape?: keyof typeof SHAPE;
  /** The title while off — what the verb does. */
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 border text-xs cursor-pointer disabled:opacity-50 disabled:cursor-default ${SHAPE[shape]} ${look(armed ? 'armed' : state, shape)}`}
      aria-pressed={armed || state !== 'off'}
      disabled={disabled}
      title={armed ? undefined : state === 'off' ? hint : AUTO_SWITCH_TITLE[state]}
      onClick={onClick}
    >
      {!armed && <Dot state={state} />}
      {children}
    </button>
  );
}
