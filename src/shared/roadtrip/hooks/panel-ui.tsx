/**
 * The bits of panel a hook variant's options share. A variant's panel mounts
 * INSIDE the picker's "Opener" section, so it cannot open sections of its own
 * — the inspector's grammar is sections of rows — and groups its rows under a
 * small mono legend instead.
 */

import type { ReactNode } from 'react';

/** A small mono legend over a group of rows — a panel's sub-sections. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-mono text-2xs tracking-[0.14em] uppercase text-muted">{title}</span>
      {children}
    </div>
  );
}
