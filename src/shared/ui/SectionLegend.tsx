import type { ReactNode } from 'react';
import InfoDot from './InfoDot';

/**
 * A settings-section legend, with its explanation folded behind an ⓘ.
 *
 * The studio's modals explain themselves — why a cadence has to be corrected,
 * why the capture time is a shift and not a timezone — and that prose was
 * pushing the controls (and, on a phone, the Apply button) below the fold. It
 * is not noise and it is not deleted: it is one tap away, and the tap is next
 * to the word it explains.
 *
 * It lives in `shared/` because Road Trip's piece editor became its second
 * consumer — same move `StylePanel` and `GradePanel` already made, and
 * `shared/` never imports `tools/`. The dot itself is `InfoDot`, shared in turn
 * with the surfaces that fold a paragraph away without having a legend.
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
  return (
    /* The row wraps and the note is `basis-full`, so an open note takes the
       line under the label rather than squeezing it as a second flex item. */
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted">
        {label}
      </span>
      {children && <InfoDot about={label.toLowerCase()}>{children}</InfoDot>}
    </span>
  );
}
