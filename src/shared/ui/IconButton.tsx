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

const SQUARE: Record<ButtonSize, string> = {
  sm: 'w-7 px-0',
  md: 'w-[2.125rem] px-0',
  lg: 'w-10 px-0',
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
      className={buttonClass(variant, size, `${SQUARE[size]} [&>svg]:w-[1.15em] [&>svg]:h-[1.15em] ${className}`)}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
