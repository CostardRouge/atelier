/**
 * The one way a screen says "there is nothing here yet".
 *
 * Twenty-eight files wrote their own — a dashed box in the galleries, a grey
 * sentence in the library, a line in a panel — and none looked like another.
 * This is the galleries' shape made shared: a title in the serif, one
 * sentence of why it matters, and the ONE action that fills it, as a real
 * `Button`. A `compact` variant is the sentence alone, for a panel or a rail
 * where a framed box would be louder than what it announces.
 */

import type { ReactNode } from 'react';

interface EmptyStateProps {
  title?: ReactNode;
  children?: ReactNode;
  /** The action(s) that fill the emptiness — `Button`s, usually one. */
  actions?: ReactNode;
  /** A sentence with no frame, for a rail or a panel. */
  compact?: boolean;
  className?: string;
}

export default function EmptyState({
  title,
  children,
  actions,
  compact = false,
  className = '',
}: EmptyStateProps) {
  if (compact) {
    return (
      <p className={`m-0 px-2 py-6 text-center text-xs text-muted leading-relaxed ${className}`}>
        {children}
      </p>
    );
  }
  return (
    <div className={`flex-1 flex items-center justify-center ${className}`}>
      <div className="text-center max-w-[44ch] flex flex-col items-center gap-3 border border-dashed border-line-strong rounded-paper-lg px-8 py-10">
        {title && <p className="m-0 font-serif text-xl">{title}</p>}
        {children && <p className="m-0 text-sm text-muted leading-relaxed">{children}</p>}
        {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">{actions}</div>}
      </div>
    </div>
  );
}
