/**
 * A square button holding one glyph and a NAME.
 *
 * Same recipe as `Button`, same sizes — a 34px icon button beside a 34px text
 * button reads as one family — but square, and the label is required: an
 * icon-only control with no accessible name is a control a screen reader
 * calls "button", and a control with no `title` is one a mouse cannot learn.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './Button';

// The glyph is sized in pixels, not from the text: a 28px button holding a
// 12px-text-derived 14px icon read as a dash. Winnow draws 18px in 36px.
const SQUARE: Record<ButtonSize, string> = {
  sm: 'w-7 [&>svg]:w-4 [&>svg]:h-4',
  md: 'w-[2.125rem] [&>svg]:w-[18px] [&>svg]:h-[18px]',
  lg: 'w-10 [&>svg]:w-5 [&>svg]:h-5',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** What it does, in words — becomes the accessible name and the tooltip. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'default', size = 'md', className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={buttonClass(variant, size, `${SQUARE[size]} ${className}`, { square: true })}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
