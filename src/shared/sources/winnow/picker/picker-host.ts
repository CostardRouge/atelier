import type { ReactNode } from 'react';
import type { DaySpan } from '../../scope-override';
import type { LibraryHalf, WinnowAssetRow } from '../client';
import type { OpeningTicks } from './pick-filter';

/**
 * What a HOST tells the Winnow picker — the one modal behind the Library's
 * *browse all* and Develop's *Add a day* (`docs/winnow-day-sheet-verdicts.md`
 * §7). Everything the two have in common is the picker's own: the scope, the
 * day stepper, the rail, the grid, the marks, the tick verbs. What differs —
 * what counts as already there, what is ticked on open, what the verbs at the
 * end of the bar DO — comes in here, so the picker knows no tool.
 */
export interface PickerHost {
  /** The sheet's title — `Add from winnow.example`. */
  title: string;
  /** Where the ticked media go, said in a pill beside the title: `Library`, `Roll · Whitsundays`. */
  destination: string;
  /** Where it opens: always a day; a half when the host is looking at one (the sidebar). */
  start: { day: string; half?: LibraryHalf | null };
  /** The host's own day and the span around it, marked in the month (the sidebar's anchor). */
  anchor?: PickerAnchor | null;
  /** Already where this host would put it — drawn but never ticked. */
  held: (row: WinnowAssetRow) => boolean;
  /** How a held tile is labelled: `in library`, `on the roll`. */
  heldLabel: string;
  /** What is ticked when a scope's rows arrive (`openingTicks`). */
  openTicks: OpeningTicks;
  /** The rows this host can take at all; the others are not listed. Absent: every row. */
  accepts?: (row: WinnowAssetRow) => boolean;
  /**
   * Controls drawn in the bar before the actions — the Library's *Proxies ·
   * Originals* and the weight it would download. Handed the ticked rows.
   */
  extras?: (ticked: readonly WinnowAssetRow[]) => ReactNode;
  /** The bar's verbs, in order; the last one is the primary (Enter). */
  actions: readonly PickerAction[];
}

export interface PickerAnchor {
  span: DaySpan;
  /** What it is, in the host's words — `Day 9`, `the open picture`. */
  label: string;
  /** Who has it open — `Trips`, `Develop`. */
  publisher: string;
  within?: { span: DaySpan; label: string } | null;
}

export interface PickerActionContext {
  /** Aborted by the picker's Cancel, its close, or its unmount. */
  signal: AbortSignal;
  /** A line the bar shows while the action runs; null clears it. */
  progress: (text: string | null) => void;
}

export interface PickerAction {
  key: string;
  /** The verb for `n` ticked media — `Add 12 to library`. */
  label: (n: number) => string;
  /**
   * Do it. Resolve `true` to close the picker (the add landed), anything else
   * to stay open — a failure the host has said, or a run that was stopped.
   */
  run: (rows: WinnowAssetRow[], ctx: PickerActionContext) => Promise<boolean | void>;
}
