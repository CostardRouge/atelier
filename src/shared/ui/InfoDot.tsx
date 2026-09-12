import { useId, useState, type ReactNode } from 'react';

/**
 * An ⓘ that folds a standing explanation away until it is asked for.
 *
 * `SectionLegend` had this inside it, next to an uppercase section label. The
 * prose it hides, though, is not only attached to sections: a modal's subtitle,
 * a sidebar's footer and a panel's bridge each carried a paragraph that is true
 * every time and read once. So the dot moved out and the legend became its
 * first caller — one affordance everywhere, rather than a second one invented
 * per surface.
 *
 * It renders a fragment — the button, then the note as a block under it — so a
 * caller decides where both sit: inside a flex column, inline in the sentence
 * the note expands, or — `basis-full` on the note — on the line under a wrapping
 * flex row.
 */
export default function InfoDot({
  about,
  children,
}: {
  /** What the note is about, for the button's accessible name. */
  about: string;
  /** The long-form why. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`About ${about}`}
        title={open ? 'Hide the note' : 'What is this?'}
        /* The ring is 16px so it sits on the cap height of a legend; the
           invisible ::after gives it a 32px touch target, which is what a
           thumb actually needs. */
        className={`relative flex-none w-4 h-4 inline-grid place-items-center align-[-0.15em] rounded-full border font-serif text-[0.62rem] leading-none cursor-pointer transition-colors after:absolute after:-inset-2 after:content-[''] ${
          open
            ? 'border-accent bg-accent-wash text-accent-ink'
            : 'border-line-strong bg-transparent text-muted hover:text-accent-ink hover:border-accent'
        }`}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          className="block basis-full mt-1.5 text-[0.72rem] leading-relaxed text-muted [&>p]:m-0 [&>p+p]:mt-1.5"
        >
          {children}
        </span>
      )}
    </>
  );
}
