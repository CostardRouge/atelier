import { useEffect, useMemo, useState } from 'react';
import { downloadBlob } from '../../shared/media/save';
import { serializeTripFile, toTripFile, tripFileName } from '../../shared/roadtrip/trip-file';
import {
  canReset,
  resetStages,
  stageResetCounts,
  type StageReset,
  type StageResetCounts,
} from '../../shared/roadtrip/stage-reset';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import SectionLegend from '../../shared/ui/SectionLegend';
import { smallButton } from './panels/ui';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What each width asks, does and loses — said with the trip's own counts. */
const RESET_WORDS: Record<
  StageReset,
  { label: (c: StageResetCounts) => string; question: string; verb: string; lost: (c: StageResetCounts) => string }
> = {
  deduced: {
    label: (c) => `Remove what Deduce added (${c.deduced})`,
    question: 'Remove the legs Deduce added?',
    verb: 'Remove',
    lost: (c) => `${plural(c.deduced, 'leg')} written by Deduce go, with their places. The legs you made yourself stay as they are.`,
  },
  places: {
    label: (c) => `Clear the places (${c.places})`,
    question: 'Clear every placed place?',
    verb: 'Clear the places',
    lost: (c) =>
      `${plural(c.places, 'place')}${c.located ? `, ${c.located} of them on the map,` : ''} leave the trip's ${plural(c.stages, 'leg')}. The legs keep their dates and names, ready to be placed again.`,
  },
  stages: {
    label: (c) => `Remove every leg (${c.stages})`,
    question: 'Start the legs from zero?',
    verb: 'Remove every leg',
    lost: (c) =>
      `${plural(c.stages, 'leg')} and their ${plural(c.places, 'place')} go. The calendar is left bare for a new Deduce, a timeline import or legs drawn by hand.`,
  },
};

/**
 * Trip settings → Backup and start over: the whole trip as a file, and the
 * three widths of starting the legs over (2026-10-09, the maintainer: after a
 * Deduce run on wrong days, forty legs deleted one by one). A verb is drawn
 * only when it has something to do, each asks first with its counts, and the
 * trip's undo takes it back in one step. Pieces, dates and state codes are
 * never touched (`stage-reset.ts`).
 */
export default function TripKeepSection({
  trip,
  onChange,
  onNested,
}: {
  trip: TripDoc;
  onChange: (trip: TripDoc) => void;
  /** The question is up: the sheet behind leaves Escape and Enter to it. */
  onNested?: (open: boolean) => void;
}) {
  const [resetting, setResetting] = useState<StageReset | null>(null);
  const counts = useMemo(() => stageResetCounts(trip), [trip]);
  useEffect(() => {
    onNested?.(resetting !== null);
  }, [resetting, onNested]);

  const backUp = () =>
    downloadBlob(new Blob([serializeTripFile(toTripFile(trip))], { type: 'application/json' }), tripFileName(trip.name));

  // Removing what Deduce added IS removing every leg when Deduce wrote them
  // all — one verb, not two saying the same thing.
  const offered = (['deduced', 'places', 'stages'] as const).filter(
    (w) => canReset(counts, w) && !(w === 'deduced' && counts.deduced === counts.stages),
  );

  return (
    <>
      <SectionLegend label="Backup">
        <p>The whole trip as a file — days, legs, pieces, looks, words, road and theme. Not the pictures themselves, found again by their hash.</p>
      </SectionLegend>
      <span>
        <button type="button" onClick={backUp} className={smallButton}>
          ↓ Back up the trip
        </button>
      </span>

      <SectionLegend label="Start over">
        <p>Clears what the legs hold, so a Deduce or a timeline import can start from a clean calendar.</p>
        <p>Pieces, the trip&apos;s dates and its state codes are never touched, and ⌘Z takes it back.</p>
      </SectionLegend>
      {offered.length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {offered.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setResetting(w)}
              className="p-0 border-0 bg-transparent text-sm text-muted cursor-pointer underline underline-offset-[3px] hover:text-danger"
            >
              {RESET_WORDS[w].label(counts)}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted">No leg to start over.</span>
      )}

      {resetting && (
        <ConfirmDialog
          title={RESET_WORDS[resetting].question}
          confirmLabel={RESET_WORDS[resetting].verb}
          danger
          onCancel={() => setResetting(null)}
          onConfirm={() => {
            const what = resetting;
            setResetting(null);
            onChange(resetStages(trip, what));
          }}
        >
          <p>{RESET_WORDS[resetting].lost(counts)}</p>
          <p className="mt-2">
            Pieces, dates and the state codes stay; ⌘Z takes it back.{' '}
            <button
              type="button"
              onClick={backUp}
              className="p-0 border-0 bg-transparent text-sm text-accent-ink underline underline-offset-[3px] cursor-pointer"
            >
              Back up the trip first
            </button>
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
