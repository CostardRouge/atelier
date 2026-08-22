import { useId, useState, type ReactNode } from 'react';

/**
 * A settings-section legend, with its explanation folded behind an ⓘ.
 *
 * The studio's modals explain themselves — why a cadence has to be corrected,
 * why the capture time is a shift and not a timezone — and that prose was
 * pushing the controls (and, on a phone, the Apply button) below the fold. It
 * is not noise and it is not deleted: it is one tap away, and the tap is next
 * to the word it explains.
 *
 * Omit `children` and the section gets a plain legend, no button — a control
 * that needs no explanation should not advertise one.
 */
export default function SectionLegend({
  label,
  children,
}: {
  label: string;
  /** The long-form why. Absent = no ⓘ at all. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted">
          {label}
        </span>
        {children && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={id}
            aria-label={`About ${label.toLowerCase()}`}
            title={open ? 'Hide the note' : 'What is this?'}
            /* The ring is 16px so it sits on the cap height of the legend; the
               invisible ::after gives it a 32px touch target, which is what a
               thumb actually needs. */
            className={`relative flex-none w-4 h-4 grid place-items-center rounded-full border font-serif text-[0.62rem] leading-none cursor-pointer transition-colors after:absolute after:-inset-2 after:content-[''] ${
              open
                ? 'border-accent bg-accent-wash text-accent-ink'
                : 'border-line-strong bg-transparent text-muted hover:text-accent-ink hover:border-accent'
            }`}
          >
            i
          </button>
        )}
      </span>
      {children && open && (
        <span
          id={id}
          className="block text-[0.72rem] leading-relaxed text-muted [&>p]:m-0 [&>p+p]:mt-1.5"
        >
          {children}
        </span>
      )}
    </>
  );
}
