import { useState } from 'react';
import { formatIsoDate, spanLength } from '../../shared/roadtrip/trip-days';
import { stageLabel, stageRegionLabel } from '../../shared/roadtrip/trip-places';
import {
  createTripStage,
  stageProblem,
  type TripDoc,
  type TripStage,
} from '../../shared/roadtrip/trip-types';
import PlacesEditor from './PlacesEditor';

interface StagesPanelProps {
  trip: TripDoc;
  onChange: (stages: TripStage[]) => void;
  /** Connected Winnows whose timeline can complete the stages; empty shows nothing. */
  timelineSources?: string[];
  onCompleteFrom?: (sourceId: string) => void;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const inputClass =
  'font-sans text-[0.84rem] px-2.5 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';

function StageRow({
  trip,
  stage,
  onChange,
  onDelete,
}: {
  trip: TripDoc;
  stage: TripStage;
  onChange: (stage: TripStage) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const problem = stageProblem(trip, stage);
  const nights = spanLength(stage.startDate, stage.endDate);
  // What the badge would REALLY say for this stage as it stands — never an
  // invented example. An empty name field showing "Perth → Cairns" is how the
  // author sees that clearing it computes rather than blanks.
  const derivedName = stageLabel({ ...stage, name: '' });
  const derivedRegion = stageRegionLabel({ ...stage, region: '' });

  return (
    <li className="flex flex-col gap-1.5 py-2.5 border-b border-line last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={stage.name}
          onChange={(e) => onChange({ ...stage, name: e.target.value })}
          placeholder={derivedName || 'The Red Centre'}
          className={`${inputClass} flex-1 min-w-[8rem]`}
          aria-label="Stage name"
        />
        <input
          value={stage.region}
          onChange={(e) => onChange({ ...stage, region: e.target.value })}
          placeholder={derivedRegion || 'Western Australia'}
          className={`${inputClass} flex-1 min-w-[8rem]`}
          aria-label="Region"
        />
        <input
          type="date"
          value={stage.startDate}
          min={trip.startDate}
          max={trip.endDate}
          onChange={(e) => onChange({ ...stage, startDate: e.target.value })}
          className={inputClass}
          aria-label="Arrived"
        />
        <input
          type="date"
          value={stage.endDate}
          min={trip.startDate}
          max={trip.endDate}
          onChange={(e) => onChange({ ...stage, endDate: e.target.value })}
          className={inputClass}
          aria-label="Left"
        />
        {confirming ? (
          <span className="flex items-center gap-2 text-[0.75rem]">
            <button
              type="button"
              onClick={onDelete}
              className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="p-0 border-0 bg-transparent text-muted cursor-pointer"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-[#9a3a23]"
            aria-label={`Delete ${stage.name || 'this stage'}`}
          >
            Delete
          </button>
        )}
      </div>
      <p
        className={`m-0 font-mono text-[0.68rem] ${problem ? 'text-[#9a3a23]' : 'text-faint'}`}
        role={problem ? 'alert' : undefined}
      >
        {problem ??
          (nights === null
            ? ''
            : [
                stageLabel(stage),
                `${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)}`,
                `${nights} day${nights === 1 ? '' : 's'}`,
              ]
                .filter(Boolean)
                .join(' · '))}
      </p>
      <PlacesEditor
        stage={stage}
        onChange={(places) => onChange({ ...stage, places })}
      />
    </li>
  );
}

/**
 * The places the trip stopped at. Without these a badge has no place to name
 * and the "day at the place" counters have nothing to count inside — so this
 * is not a nicety, it is what makes half the badge modes reachable.
 *
 * Stages may overlap on purpose: a travel day belongs to the place you left
 * and the one you reached, and `stageAt` gives it to where you ended up.
 */
export default function StagesPanel({
  trip,
  onChange,
  timelineSources = [],
  onCompleteFrom,
}: StagesPanelProps) {
  const [open, setOpen] = useState(false);

  function add() {
    const last = trip.stages[trip.stages.length - 1];
    const start = last ? last.endDate : trip.startDate;
    onChange([...trip.stages, createTripStage('', '', start, start)]);
    setOpen(true);
  }

  return (
    <section
      className="flex flex-col gap-2 bg-surface border border-line rounded-paper-lg p-5"
      aria-label="Stages"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`flex-1 flex items-center gap-2 p-0 border-0 bg-transparent cursor-pointer text-left ${legend}`}
        >
          <span>
            Stages · {trip.stages.length} leg
            {trip.stages.length === 1 ? '' : 's'}
          </span>
          <span className="text-faint" aria-hidden="true">
            {open ? '−' : '+'}
          </span>
        </button>
        {/* The timeline of a connected Winnow proposes what this list lacks —
            a diff the author accepts leg by leg, never a sync. */}
        {onCompleteFrom &&
          timelineSources.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onCompleteFrom(id)}
              title={`Compare these stages with ${id}'s timeline and take what you want`}
              className="flex-none px-3 py-1.5 border border-line-strong rounded-full bg-paper text-[0.76rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
            >
              ↓ From {id}
            </button>
          ))}
        <button
          type="button"
          onClick={add}
          className="flex-none px-3 py-1.5 border border-line-strong rounded-full bg-paper text-[0.76rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
        >
          + Stage
        </button>
      </div>

      {open &&
        (trip.stages.length === 0 ? (
          <p className="m-0 text-[0.8rem] text-muted">
            A stage is a leg of the trip and the days you were on it. Add one
            and a badge can name it, count the days you stayed, or say which day
            of the stop a picture is. List the places it went through and its
            name writes itself — “Perth → Cairns”.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col">
            {trip.stages.map((stage) => (
              <StageRow
                key={stage.id}
                trip={trip}
                stage={stage}
                onChange={(next) =>
                  onChange(trip.stages.map((s) => (s.id === next.id ? next : s)))
                }
                onDelete={() => onChange(trip.stages.filter((s) => s.id !== stage.id))}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}
