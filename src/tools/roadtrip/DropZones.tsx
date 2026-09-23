import type { ReactNode } from 'react';
import { Icons } from '../../shared/ui/icons';
import {
  dropAnnouncement,
  dropChip,
  dropHint,
  type ChipTone,
  type DropChip,
  type DropPhase,
  type DropZone,
} from './drop-zones';

/** A drop's state as the stage reports it. */
export interface DropState {
  /** A picture is being dragged somewhere in the app. */
  armed: boolean;
  /** The zone under the pointer, while there is one. */
  over: number | null;
  /** What the drop has become since it was let go, for a moment. */
  settled: { cell: number; phase: Exclude<DropPhase, 'over'>; reason?: string | null } | null;
  /** The picture being (or just) dropped. */
  label: string;
  /** Where it is fetched from, for an instance tile. */
  source: string | null;
}

interface DropZonesProps {
  zones: readonly DropZone[];
  state: DropState;
  collage: boolean;
}

const TONE: Record<ChipTone, string> = {
  accent: 'bg-frame text-on-media',
  muted: 'bg-frame text-on-media',
  ok: 'bg-ok text-paper',
  danger: 'bg-danger text-paper',
};

function ChipIcon({ icon }: { icon: DropChip['icon'] }): ReactNode {
  if (icon === 'wait') {
    return (
      <span
        aria-hidden="true"
        className="inline-block w-3 h-3 rounded-full border-2 border-on-media/30 border-t-on-media motion-safe:animate-spin"
      />
    );
  }
  const glyph =
    icon === 'plus' ? Icons.plus : icon === 'swap' ? Icons.swap : icon === 'check' ? Icons.check : Icons.warning;
  return <span className="inline-flex text-sm leading-none">{glyph}</span>;
}

/**
 * The drop targets drawn OVER the stage while a picture is dragged out of the
 * Library — the feedback half of a drag, which the maintainer asked to be
 * done properly:
 *
 * - **the moment a drag starts anywhere**, every cell shows it can take a
 *   picture (a dashed outline, a faint wash) and a hint names the gesture, so
 *   the target is found before the pointer gets there;
 * - **the cell under the pointer** takes a solid outline, a stronger wash and
 *   a halo, dims the others, and says what the drop WILL do — place in an
 *   empty cell, or replace the picture a filled one holds, by name;
 * - **between cells** nothing lights up and the browser shows the no-drop
 *   cursor (the stage refuses the drop there);
 * - **after the drop** the cell answers: a spinner while an instance tile is
 *   fetched, then a ring spreading from its edge and a "Placed" chip, or a
 *   danger chip saying why it did not land;
 * - a screen reader hears each of those, through a polite live region.
 *
 * It is DOM, not canvas: it animates with CSS, wears the theme's tokens and
 * takes no pointer events, so the canvas under it still receives the drag.
 * Motion is `motion-safe` throughout; with reduced motion the states simply
 * change.
 */
export default function DropZones({ zones, state, collage }: DropZonesProps) {
  const { armed, over, settled, label, source } = state;
  const active = armed || settled !== null;

  const liveZone =
    settled !== null
      ? zones.find((z) => z.index === settled.cell)
      : over !== null
        ? zones.find((z) => z.index === over)
        : undefined;
  const announcement = liveZone
    ? dropAnnouncement({
        phase: settled?.phase ?? 'over',
        zone: liveZone,
        collage,
        label,
        source,
        reason: settled?.reason,
      })
    : '';

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden={!active}>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {active &&
        zones.map((zone) => {
          const isOver = settled === null && over === zone.index;
          const settledHere = settled !== null && settled.cell === zone.index;
          const dimmed = settled === null && over !== null && !isOver;
          const phase: DropPhase | null = settledHere ? settled.phase : isOver ? 'over' : null;
          const chip = phase
            ? dropChip({ phase, zone, collage, label, source, reason: settled?.reason })
            : null;

          const frame = settledHere
            ? settled.phase === 'failed'
              ? 'border-2 border-solid border-danger bg-danger/15'
              : settled.phase === 'fetching'
                ? 'border-2 border-solid border-accent bg-frame/45'
                : 'border-2 border-solid border-accent bg-accent/10 motion-safe:animate-[drop-settle_650ms_var(--ease-paper)_both]'
            : isOver
              ? 'border-[3px] border-solid border-accent bg-accent/25 ring-4 ring-accent/30'
              : armed
                ? `border-2 border-dashed border-on-media bg-accent/15 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.4)] ${
                    dimmed ? 'opacity-40' : ''
                  }`
                : 'border-0';
          // A waiting cell carries a quiet "+" at its centre: a target reads as
          // one from across the screen, before the pointer is near it.
          const waiting = armed && !phase;

          return (
            <div
              key={zone.index}
              className="absolute"
              style={{
                left: zone.x,
                top: zone.y,
                width: zone.w,
                height: zone.h,
                transform: zone.rotation ? `rotate(${zone.rotation}deg)` : undefined,
              }}
            >
              <div
                className={`absolute inset-0 rounded-[4px] transition-[border-color,background-color,box-shadow,opacity] duration-150 ease-out motion-reduce:transition-none ${frame}`}
              />
              {waiting && (
                <div
                  className={`absolute inset-0 grid place-items-center transition-opacity duration-150 motion-reduce:transition-none ${
                    dimmed ? 'opacity-40' : 'opacity-90'
                  }`}
                >
                  <span className="grid place-items-center w-9 h-9 rounded-full bg-frame/55 text-on-media text-lg ring-1 ring-on-media/60 motion-safe:animate-[drop-chip_160ms_var(--ease-paper)_both]">
                    {Icons.plus}
                  </span>
                </div>
              )}
              {settledHere && settled.phase === 'fetching' && (
                // The fetch has no length anyone can know: an indeterminate
                // bar along the cell's foot, the suite's own (`deck-load`).
                <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-on-media/20">
                  <div className="h-full w-1/4 bg-accent motion-safe:animate-deck-load" />
                </div>
              )}
              {chip && (
                <div className="absolute inset-0 grid place-items-center p-2">
                  <span
                    key={`${phase}-${zone.index}`}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 shadow-paper motion-safe:animate-[drop-chip_160ms_var(--ease-paper)_both] ${TONE[chip.tone]}`}
                  >
                    <ChipIcon icon={chip.icon} />
                    <span className="font-sans text-xs font-semibold whitespace-nowrap">{chip.title}</span>
                    {chip.detail && (
                      <span className="min-w-0 truncate font-mono text-3xs uppercase tracking-[0.08em] opacity-75">
                        {chip.detail}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      {armed && over === null && settled === null && (
        // Named once, above the zones, while the pointer has not reached one.
        <div className="absolute inset-x-0 top-2 flex justify-center px-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-frame/85 px-3 py-1 font-mono text-3xs uppercase tracking-[0.1em] text-on-media shadow-paper motion-safe:animate-[drop-chip_160ms_var(--ease-paper)_both]">
            <span className="inline-flex text-xs leading-none">{Icons.plus}</span>
            {dropHint(collage, zones.length)}
          </span>
        </div>
      )}
    </div>
  );
}
