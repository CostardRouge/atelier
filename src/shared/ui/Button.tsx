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

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center shrink-0 whitespace-nowrap font-sans font-medium ' +
  'rounded-control border cursor-pointer select-none ' +
  'transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-paper ' +
  'active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 gap-1 text-xs',
  md: 'h-[2.125rem] px-3.5 gap-1.5 text-sm',
  lg: 'h-10 px-4 gap-2 text-sm',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-ink bg-ink text-paper font-semibold shadow-[0_2px_10px_-4px_rgba(27,24,19,0.4)] ' +
    'hover:bg-accent hover:border-accent',
  default:
    'border-line-strong bg-surface text-ink shadow-[0_1px_1.5px_rgba(27,24,19,0.04)] ' +
    'hover:bg-paper-2 hover:border-muted',
  ghost: 'border-transparent bg-transparent text-ink-soft hover:bg-paper-2 hover:text-ink',
  danger:
    'border-line-strong bg-surface text-danger ' +
    'hover:bg-danger-wash hover:border-danger-line hover:text-danger-ink',
};

/** The whole recipe as one string, for a control that cannot be a `<button>`. */
export function buttonClass(
  variant: ButtonVariant = 'default',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${extra}`.trim();
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A leading glyph, drawn at the text's size. */
  icon?: ReactNode;
  /** A trailing one — a chevron on a menu button, a shortcut hint. */
  trailing?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, trailing, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon && <span className="inline-flex shrink-0 [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{icon}</span>}
      {children}
      {trailing && (
        <span className="inline-flex shrink-0 [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{trailing}</span>
      )}
    </button>
  );
});

export default Button;
