import type { ReactNode } from 'react';
import { PRESS_LOOK } from '../ui/press';
import { useVerb } from '../ui/use-verb';
import { VERB_GROUND, VERB_SHAPE, VerbHairline, verbAttrs } from '../ui/VerbMarks';
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
  instant = false,
  echo = null,
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
  /**
   * A switch that only ARMS a tool (Pick grey's dropper) answers at once; the
   * others measure the picture and re-render it, so they live as a verb
   * (`useVerb`): down while that runs, ✓ when the picture has caught up.
   */
  instant?: boolean;
  /** The task scope of the picture it re-renders: its edge echoes the work (C4). */
  echo?: string | null;
  /** A promise keeps the verb down until it settles (a model asked). */
  onClick: () => void | Promise<unknown>;
  children: ReactNode;
}) {
  const verb = useVerb();
  return (
    <button
      type="button"
      className={`relative inline-flex items-center gap-1.5 border text-xs cursor-pointer disabled:opacity-50 disabled:cursor-default transition-[background-color,border-color,color,translate,box-shadow] duration-150 ease-paper ${PRESS_LOOK} data-pressed:bg-paper-2 ${VERB_SHAPE} ${VERB_GROUND} ${SHAPE[shape]} ${look(armed ? 'armed' : state, shape)}`}
      aria-pressed={armed || state !== 'off'}
      disabled={disabled}
      title={armed ? undefined : state === 'off' ? hint : AUTO_SWITCH_TITLE[state]}
      {...verbAttrs(verb.phase)}
      onClick={() => (instant || armed ? void onClick() : verb.run(async () => void (await onClick()), { echo }))}
    >
      {!armed && <Dot state={state} />}
      {children}
      <VerbHairline phase={verb.phase} />
    </button>
  );
}
