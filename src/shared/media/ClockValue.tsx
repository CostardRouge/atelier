import type { ReactNode } from 'react';
import type { PlayClock } from './play-clock';
import { useClockSelect } from './use-play-clock';

/**
 * A LEAF that follows a `PlayClock` (`performance.md` rule 1): it re-renders
 * its children whenever what `select` reads changes, so a band's needle or a
 * readout moves with the film while the editor around it stays still. The
 * children are a function of the selected value, built from the host's last
 * render — the host renders again only when something else changes.
 */
export default function ClockValue<T>({ clock, select, children }: { clock: PlayClock; select: (clock: PlayClock) => T; children: (value: T) => ReactNode }) {
  const value = useClockSelect(clock, select);
  return <>{children(value)}</>;
}
