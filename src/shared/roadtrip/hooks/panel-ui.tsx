/**
 * The bits of panel a hook variant's options share. A variant's panel mounts
 * INSIDE the picker's "Opener" section, so it cannot open sections of its own
 * — the inspector's grammar is sections of rows — and groups its rows under a
 * small mono legend instead.
 */

import type { ReactNode } from 'react';
import { FieldRow, Readout } from '../../ui/Inspector';

/** An underlined text verb that puts one value back. */
export const resetLink =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink';

/**
 * The way back from a drag on the stage: where the opener was moved to, and
 * "Put it back". A drag must have one, or the coarse placement above it stops
 * meaning anything — the one-way-door rule the cover panel had to be taught.
 * The caller shows it only once there is something to undo.
 */
export function MovedRow({
  offsetX,
  offsetY,
  onReset,
}: {
  offsetX: number;
  offsetY: number;
  onReset: () => void;
}) {
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  return (
    <FieldRow label="Moved" hint="Dragged away from the placement above.">
      <Readout muted>{`${signed(offsetX)}, ${signed(offsetY)}`}</Readout>
      <button type="button" onClick={onReset} className={resetLink}>
        Put it back
      </button>
    </FieldRow>
  );
}

/** A small mono legend over a group of rows — a panel's sub-sections. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-mono text-2xs tracking-[0.14em] uppercase text-muted">{title}</span>
      {children}
    </div>
  );
}
