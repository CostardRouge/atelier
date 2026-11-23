import { forwardRef, type HTMLAttributes } from 'react';

export interface StageFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** The black is drawn; false leaves the box clear (nothing on the stage yet). */
  lit?: boolean;
  /**
   * Edge to edge: no rounding — a phone's immersive stage, whose backdrop the
   * shell already paints black (`stageChrome`).
   */
  bleed?: boolean;
  /** The corner: a card's (`paper`, the default) or a control's, inside a tighter column. */
  round?: 'paper' | 'control';
  /** Clip what is drawn inside to the frame. Off for a stage whose children overflow on purpose. */
  clip?: boolean;
}

/**
 * The black a picture is judged against — every editor's STAGE (2026-11-23,
 * his ask: «un composant commun pour le fond noir des scènes»). One look:
 * the frame's black (`--color-frame`), rounded like a card unless it bleeds,
 * and NEVER a border — a `border-line` hairline round the black read as a
 * grey frame, on a phone's black backdrop above all (`frontend.md`, «An
 * immersive editor whose stage is BLACK»). Layout, padding and gestures are
 * the caller's (`className`, props, `ref`).
 */
const StageFrame = forwardRef<HTMLDivElement, StageFrameProps>(function StageFrame(
  { lit = true, bleed = false, round = 'paper', clip = true, className = '', children, ...rest },
  ref,
) {
  const corner = bleed ? '' : round === 'control' ? 'rounded-control' : 'rounded-paper';
  return (
    <div
      ref={ref}
      {...rest}
      data-stage-frame=""
      className={`relative ${clip ? 'overflow-hidden' : ''} ${lit ? 'bg-frame' : 'bg-transparent'} ${corner} ${className}`}
    >
      {children}
    </div>
  );
});

export default StageFrame;
