/**
 * The suite's one button, and the class recipe behind it.
 *
 * Before it existed the audit of 2026-09-13 counted 337 `<button>` elements
 * in ~225 different class recipes, twenty-one of them local constants named
 * `pill`, `btn`, `chip` or `smallButton` copied between files. The recipe is
 * Winnow's `.btn` (the maintainer wants the two apps to look alike): an 11px
 * control radius, 14px medium text, a paper surface with a strong hairline,
 * the primary as solid ink — with Atelier's own vermilion on hover, which is
 * where the identity lives.
 *
 * Four variants, three sizes, and that is all: a button that needs a fifth
 * skin is a button that should not exist. `buttonClass` is exported for the
 * few places that must be a button without being a `<button>` — a `<label>`
 * over a file input, an `<a>` — so those look identical rather than close.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { PRESS_LOOK } from './press';
import type { VerbPhase } from './verb';
import { VERB_SHAPE, VerbHairline, verbAttrs, verbGlyph } from './VerbMarks';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

// Pressed is `PRESS_LOOK` (`press.ts`) — it replaced `active:scale-[0.98]`,
// a quarter of a pixel a side that a finger never saw. `aria-disabled` looks
// disabled but keeps the touch, so a tap can say WHY it is grey (`VerbWord`);
// `disabled` swallows it.
const BASE =
  'inline-flex items-center justify-center shrink-0 whitespace-nowrap font-sans font-medium ' +
  'rounded-control border cursor-pointer select-none ' +
  'transition-[background-color,border-color,color,translate,box-shadow] duration-150 ease-paper ' +
  `${PRESS_LOOK} disabled:opacity-45 disabled:pointer-events-none aria-disabled:opacity-45 aria-disabled:cursor-default ` +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1 text-xs',
  md: 'h-[2.125rem] gap-1.5 text-sm',
  lg: 'h-10 gap-2 text-sm',
};

// Padding apart from the height, because a SQUARE button (IconButton) takes
// the height and a width instead — and two `px-*` utilities on one element
// are resolved by Tailwind's own order, not by which came last, so an
// override was silently losing to `px-2.5` and squeezing the glyph to 6px.
const PADDINGS: Record<ButtonSize, string> = {
  sm: 'px-2.5',
  md: 'px-3.5',
  lg: 'px-4',
};

// Each variant's PRESSED ground too: under a finger there is no hover
// (Tailwind v4 draws `hover:` only where the device can hover), so the press
// is the only state a touch screen ever shows — the primary takes the accent
// a mouse sees on hover. And each variant's VERB colours (`phase`): working,
// done, failed — the primary's ink ground turns green or red whole, where the
// others keep their ground and say it in their ink.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-ink bg-ink text-paper font-semibold shadow-[0_2px_10px_-4px_rgba(27,24,19,0.4)] ' +
    'hover:bg-accent hover:border-accent data-pressed:bg-accent data-pressed:border-accent ' +
    'data-[state=working]:bg-accent data-[state=working]:border-accent data-[state=working]:shadow-press ' +
    'data-[state=done]:bg-ok data-[state=done]:border-ok data-[state=failed]:bg-danger data-[state=failed]:border-danger',
  default:
    'border-line-strong bg-surface text-ink shadow-[0_1px_1.5px_rgba(27,24,19,0.04)] ' +
    'hover:bg-paper-2 hover:border-muted data-pressed:bg-paper-2 data-pressed:border-muted ' +
    'data-[state=working]:bg-paper-2 data-[state=working]:shadow-press ' +
    'data-[state=done]:text-ok data-[state=failed]:text-danger data-[state=failed]:border-danger-line',
  ghost:
    'border-transparent bg-transparent text-ink-soft hover:bg-paper-2 hover:text-ink ' +
    'data-pressed:bg-paper-2 data-pressed:text-ink data-[state=working]:bg-paper-2 ' +
    'data-[state=done]:text-ok data-[state=failed]:text-danger',
  danger:
    'border-line-strong bg-surface text-danger ' +
    'hover:bg-danger-wash hover:border-danger-line hover:text-danger-ink ' +
    'data-pressed:bg-danger-wash data-pressed:border-danger-line data-pressed:text-danger-ink ' +
    'data-[state=working]:bg-danger-wash data-[state=working]:shadow-press data-[state=done]:text-ok',
};

/** The whole recipe as one string, for a control that cannot be a `<button>`. */
export function buttonClass(
  variant: ButtonVariant = 'default',
  size: ButtonSize = 'md',
  extra = '',
  options: { square?: boolean } = {},
): string {
  const pad = options.square ? '' : PADDINGS[size];
  return `${BASE} ${SIZES[size]} ${pad} ${VARIANTS[variant]} ${extra}`.replace(/\s+/g, ' ').trim();
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A leading glyph, drawn at the text's size. */
  icon?: ReactNode;
  /** A trailing one — a chevron on a menu button, a shortcut hint. */
  trailing?: ReactNode;
  /**
   * The life of the verb this button runs (`useVerb`): down with a hairline
   * while it works, ✓ or – in place of the icon after. Without an icon the
   * label stays and its ink says it — the button keeps its width.
   */
  phase?: VerbPhase;
}

/** The classes a button running a verb adds to its recipe; its colours are the variant's. */
export const VERB_CLASSES = `relative ${VERB_SHAPE}`;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, trailing, phase, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, phase ? `${VERB_CLASSES} ${className}` : className)}
      {...verbAttrs(phase)}
      {...rest}
    >
      {icon && <span className="inline-flex shrink-0 [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{verbGlyph(phase, icon)}</span>}
      {children}
      {trailing && (
        <span className="inline-flex shrink-0 [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{trailing}</span>
      )}
      <VerbHairline phase={phase} />
    </button>
  );
});

export default Button;
