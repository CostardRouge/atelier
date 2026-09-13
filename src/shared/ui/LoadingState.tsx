/**
 * Waiting, drawn one way: a spinner and, optionally, a word.
 *
 * The audit found eight files writing their own "Loading…" line in two
 * different styles, plus three pulse animations. `Spinner` is the ring alone
 * (inline, `1em`, for a button or a pill); `LoadingState` is the ring with its
 * label, centred, for a list that has not answered yet. Both honour
 * `prefers-reduced-motion` by standing still.
 */

interface SpinnerProps {
  /** Smaller ring, for inside a pill or a button. */
  sm?: boolean;
  className?: string;
}

export function Spinner({ sm = false, className = '' }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border-current border-r-transparent animate-spin motion-reduce:animate-none ${
        sm ? 'w-3 h-3 border-[1.5px]' : 'w-4 h-4 border-2'
      } ${className}`}
    />
  );
}

interface LoadingStateProps {
  label?: string;
  /** No padding, for a slot that is already sized. */
  inline?: boolean;
  className?: string;
}

export default function LoadingState({
  label = 'Loading…',
  inline = false,
  className = '',
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 text-sm text-muted ${
        inline ? '' : 'justify-center py-8'
      } ${className}`}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
