/**
 * What a verb's PHASE looks like on its button (`verb.ts`, `use-verb.ts`).
 *
 * Four pieces, so a recipe that is a class string (`developButtonClass`, the
 * Auto switch, a link) and the shared `Button` / `IconButton` draw the same:
 * the attributes, the shape of each phase, the hairline, and the glyph swap.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icons } from './icons';
import { useVerb, type Verb } from './use-verb';
import type { VerbOutcome, VerbPhase, VerbReturn } from './verb';

/** The attributes a verb's button wears: its phase as `data-state`, busy while it works. */
export function verbAttrs(phase: VerbPhase | undefined): { 'data-state'?: VerbPhase; 'aria-busy'?: true } {
  if (!phase || phase === 'idle') return {};
  return phase === 'working' ? { 'data-state': phase, 'aria-busy': true } : { 'data-state': phase };
}

/**
 * Each phase's SHAPE, for any recipe: the key stays down while the verb works,
 * its glyph dimmed and the cursor busy. The COLOURS are the recipe's — a link
 * takes `VERB_INK`, a recipe with a ground `VERB_GROUND`, and `Button`'s
 * variants their own (a primary's ink ground cannot take a green ink) —
 * because two utilities of one property resolve by Tailwind's order, not the
 * class list's (`frontend.md`).
 */
export const VERB_SHAPE =
  'data-[state=working]:translate-y-px data-[state=working]:cursor-progress data-[state=working]:[&>svg]:opacity-50';

/** How it went, in the ink alone: for a recipe with no ground (a link). */
export const VERB_INK = 'data-[state=done]:text-ok data-[state=failed]:text-danger';

/** A light ground's phases: shaded while it works, and the ink after. */
export const VERB_GROUND =
  'data-[state=working]:shadow-press data-[state=working]:bg-paper-2 data-[state=failed]:border-danger-line ' + VERB_INK;

/**
 * The hairline under a verb that works: shown only once the verb has lasted
 * `VERB_WAIT_MS` (`animate-verb-wait`), so a quick one never blinks it. The
 * button must be `relative`.
 */
export function VerbHairline({ phase }: { phase?: VerbPhase }) {
  if (phase !== 'working') return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-1.5 bottom-[3px] h-0.5 overflow-hidden rounded-full animate-verb-wait"
    >
      <span className="block h-full w-2/5 rounded-full bg-accent animate-deck-load motion-reduce:animate-none" />
    </span>
  );
}

/**
 * The glyph a verb shows: its own, ✓ once it worked, – when it could not. A
 * glyph is SWAPPED, never added: a text button without one keeps its width
 * and says it in its ink instead — a toolbar never inserts a control.
 */
export function verbGlyph(phase: VerbPhase | undefined, glyph: ReactNode): ReactNode {
  if (phase === 'done') return Icons.check;
  if (phase === 'failed') return Icons.minus;
  return glyph;
}

export interface VerbButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> {
  /** The verb's work; its return says how it went (`VerbReturn`). */
  onRun: () => VerbReturn | Promise<VerbReturn>;
  /** Hears how each run went — a host's word beside the verbs. */
  onOutcome?: (outcome: VerbOutcome) => void;
  /** A verb owned by the host instead (a keyboard shortcut drives the same one). */
  verb?: Verb;
  /** A leading glyph, swapped for ✓ or – after a run. */
  glyph?: ReactNode;
  /**
   * Why the verb cannot run now. Set, the button LOOKS disabled
   * (`aria-disabled`) but keeps the touch, and a press says this instead of
   * running — a tooltip is the only other place it lived, and a finger never
   * shows one. The recipe styles `aria-disabled:`.
   */
  refusal?: string | null;
  children?: ReactNode;
}

/**
 * A raw `<button>` that is a verb: for a recipe that is a class string. It
 * owns its life (`useVerb`) unless the host hands one in.
 */
export function VerbButton({ onRun, onOutcome, verb, glyph, refusal, className = '', children, type = 'button', ...rest }: VerbButtonProps) {
  const own = useVerb(onOutcome);
  const v = verb ?? own;
  return (
    <button
      type={type}
      {...rest}
      {...verbAttrs(v.phase)}
      aria-disabled={refusal ? true : undefined}
      className={`relative ${VERB_SHAPE} ${className}`}
      onClick={() => (refusal ? v.refuse(refusal) : v.run(onRun))}
    >
      {glyph !== undefined && verbGlyph(v.phase, glyph)}
      {children}
      <VerbHairline phase={v.phase} />
    </button>
  );
}
