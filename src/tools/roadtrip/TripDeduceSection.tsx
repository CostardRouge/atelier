import { useMemo } from 'react';
import { roadSourceText } from '../../shared/roadtrip/road-track';
import { stageResetCounts } from '../../shared/roadtrip/stage-reset';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { buttonClass } from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';

/** How many of the trip's stages Deduce wrote, said without «1 stages». */
function writtenLine(stages: number, deduced: number): string {
  if (stages === 0) return 'The trip has no stage yet.';
  if (stages === 1) return deduced ? 'Its one stage was written by Deduce.' : 'Its one stage was not written by Deduce.';
  if (deduced === 0) return `None of its ${stages} stages was written by Deduce.`;
  if (deduced === stages) return `All ${stages} of its stages were written by Deduce.`;
  return `${deduced} of its ${stages} stages ${deduced === 1 ? 'was' : 'were'} written by Deduce.`;
}

/** What Deduce does — the section's ⓘ. */
export const DEDUCE_ABOUT = (
  <>
    <p>
      Deduce works the stages out from where your pictures say each day was: it asks the instance for one position per
      day, cuts the trip where you moved, and names each stop from the shipped index — or from your own steps when a
      Polarsteps export is dropped in its window.
    </p>
    <p>
      Nothing is written until its Review: a proposal never writes over a stage of yours, and every stage it writes is
      marked, so a later run recognises them and they can be taken out in one go.
    </p>
  </>
);

/**
 * Trip settings → Deduce: the door to the Deduce window, one per connected
 * instance, and what Deduce has already written in this trip. The window
 * itself stays a window — three tabs, a map and a Review need the whole
 * screen, which a pane of this sheet would halve — so its button closes the
 * sheet and opens it. Before this section, Deduce was a button in the
 * overview's bar and an item of its ⋯ (2026-10-09, his ask to move it here).
 */
export default function TripDeduceSection({
  trip,
  sources,
  onDeduce,
  onShow,
}: {
  trip: TripDoc;
  /** The connected instances; empty when none is. */
  sources: readonly string[];
  /** Close this sheet and open Deduce on that instance; absent where the host cannot. */
  onDeduce?: (sourceId: string) => void;
  /** Go to another section of the sheet. */
  onShow: (section: 'road' | 'keep') => void;
}) {
  const counts = useMemo(() => stageResetCounts(trip), [trip]);

  return (
    <>
      {!onDeduce || sources.length === 0 ? (
        <div className="flex flex-col items-start gap-2.5 px-4 py-3.5 border border-line rounded-paper bg-paper-2">
          <p className="m-0 text-sm text-ink-soft">
            Deduce asks a connected Winnow where each day was. No instance is connected in this browser.
          </p>
          <a href="#/sources" className={buttonClass('default', 'sm')}>
            Connect an instance
          </a>
        </div>
      ) : (
        <div className="flex flex-col border border-line rounded-paper overflow-hidden">
          {sources.map((id, i) => (
            <div key={id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i ? 'border-t border-line' : ''}`}>
              <span className="flex-none text-muted [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
                {Icons.search}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{id}</span>
                <span className="block text-xs text-muted">One position per day, from the pictures it holds</span>
              </span>
              <button type="button" onClick={() => onDeduce(id)} className={buttonClass(i === 0 ? 'primary' : 'default', 'sm')}>
                Deduce the stages
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5 text-sm text-ink-soft">
        <p className="m-0">
          {writtenLine(counts.stages, counts.deduced)}{' '}
          {counts.deduced > 0 && (
            <button type="button" onClick={() => onShow('keep')} className="p-0 border-0 bg-transparent text-sm text-accent-ink underline underline-offset-[3px] cursor-pointer">
              Remove them…
            </button>
          )}
        </p>
        <p className="m-0">
          {trip.road
            ? `The road comes from ${roadSourceText(trip.road.source)}.`
            : 'No road yet — Deduce keeps one from a Polarsteps export.'}{' '}
          {trip.road && (
            <button type="button" onClick={() => onShow('road')} className="p-0 border-0 bg-transparent text-sm text-accent-ink underline underline-offset-[3px] cursor-pointer">
              See it…
            </button>
          )}
        </p>
      </div>
    </>
  );
}
