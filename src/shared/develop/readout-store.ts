/**
 * The pixel under the pointer, held OUTSIDE React's state (audit item 15).
 *
 * A readout changes on every mouse move over the picture; as a state of the
 * picture hook it would re-render the whole workbench — the inspector, the
 * filmstrip, every panel — sixty times a second. Held here, only the one line
 * that shows it (`DevelopHistogram`'s) subscribes and re-renders.
 */

import type { Readout } from '../render/clipping';

/** What the pointer is over, and on which side of the divider. */
export interface StageReadout {
  readout: Readout;
  /** Left of the before/after divider: the picture AS SHOT. */
  before: boolean;
}

export interface ReadoutStore {
  get: () => StageReadout | null;
  set: (next: StageReadout | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createReadoutStore(): ReadoutStore {
  let value: StageReadout | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const same =
        value === next ||
        (value &&
          next &&
          value.before === next.before &&
          JSON.stringify(value.readout) === JSON.stringify(next.readout));
      if (same) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
