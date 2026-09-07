import { useState } from 'react';
import { startStageAt } from '../../shared/roadtrip/stage-edit';
import { rulerBars, rulerGaps, stageTint } from '../../shared/roadtrip/stage-ruler';
import { formatIsoDate, spanLength, type IsoDate } from '../../shared/roadtrip/trip-days';
import { stageLabel, stageRegionLabel } from '../../shared/roadtrip/trip-places';
import { stageProblem, type TripDoc, type TripStage } from '../../shared/roadtrip/trip-types';
import StageZoomControl from '../../shared/ui/StageZoomControl';
import { useStageZoom } from '../../shared/ui/use-stage-zoom';
import PlacesEditor from './PlacesEditor';
import StageRuler from './StageRuler';

interface StagesPanelProps {
  trip: TripDoc;
  /** The leg open in the editor below the ruler; null shows the ruler alone. */
  selectedId: string | null;
  /** The day open on the overview, drawn on the ruler as a playhead. */
  cursorDate: IsoDate | null;
  onSelect: (id: string | null) => void;
  /** A leg was clicked on the ruler: open it, and go to the day it began. */
  onOpenStage: (stage: TripStage) => void;
  /** The playhead was moved on the ruler. */
  onScrub: (date: IsoDate) => void;
  onChange: (stages: TripStage[]) => void;
  /** Connected Winnows whose timeline can complete the stages; empty shows nothing. */
  timelineSources?: string[];
  onCompleteFrom?: (sourceId: string) => void;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const inputClass =
  'font-sans text-[0.84rem] px-2.5 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';
/** The header row's controls all stand 34px tall, the zoom pill's own height. */
const pill =
  'flex-none h-[2.125rem] inline-flex items-center px-3 border border-line-strong rounded-full bg-paper text-[0.76rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink';
/**
 * Adding a leg is the panel's one creative act, so it is the gallery's own
 * primary button at header size — ink-filled, vermilion on hover — rather than
 * a bordered pill indistinguishable from the status ones beside it. The `+` is
 * its own span so it keeps the monospace weight of a glyph, not of the word.
 */
const addButton =
  'flex-none h-[2.125rem] inline-flex items-center gap-1.5 pl-3 pr-3.5 border border-ink rounded-full bg-ink text-paper text-[0.78rem] font-semibold cursor-pointer transition-[transform,background-color,border-color] duration-200 ease-paper hover:bg-accent hover:border-accent active:scale-[0.98]';

function StageCard({
  trip,
  stage,
  index,
  onChange,
  onDelete,
  onClose,
}: {
  trip: TripDoc;
  stage: TripStage;
  index: number;
  onChange: (stage: TripStage) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const problem = stageProblem(trip, stage);
  const days = spanLength(stage.startDate, stage.endDate);
  // What the badge would REALLY say for this stage as it stands — never an
  // invented example. An empty name field showing "Perth → Cairns" is how the
  // author sees that clearing it computes rather than blanks.
  const derivedName = stageLabel({ ...stage, name: '' });
  const derivedRegion = stageRegionLabel({ ...stage, region: '' });

  return (
    <div
      className="flex flex-col gap-3 bg-paper border border-line-strong rounded-paper-lg p-4"
      aria-label={`Stage ${index + 1}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-none w-2.5 h-2.5 rounded-full"
          style={{ background: stageTint(index) }}
          aria-hidden="true"
        />
        <span className={`${legend} flex-1 truncate`}>
          Stage {index + 1}
          {days !== null && ` · ${days} day${days === 1 ? '' : 's'}`}
        </span>
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close this stage"
          title="Close"
          className="flex-none w-6 h-6 grid place-items-center border border-line rounded-full bg-surface text-[0.75rem] leading-none text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
        >
          ×
        </button>
      </div>

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
        <span className="font-mono text-faint" aria-hidden="true">
          →
        </span>
        <input
          type="date"
          value={stage.endDate}
          min={trip.startDate}
          max={trip.endDate}
          onChange={(e) => onChange({ ...stage, endDate: e.target.value })}
          className={inputClass}
          aria-label="Left"
        />
      </div>
      <p
        className={`m-0 font-mono text-[0.68rem] ${problem ? 'text-[#9a3a23]' : 'text-faint'}`}
        role={problem ? 'alert' : undefined}
      >
        {problem ??
          (days === null
            ? ''
            : [stageLabel(stage), `${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)}`]
                .filter(Boolean)
                .join(' · '))}
      </p>
      <PlacesEditor stage={stage} onChange={(places) => onChange({ ...stage, places })} />
    </div>
  );
}

/**
 * The places the trip stopped at. Without these a badge has no place to name
 * and the "day at the place" counters have nothing to count inside — so this
 * is not a nicety, it is what makes half the badge modes reachable.
 *
 * The legs live on a ruler (`StageRuler`) and ONE of them is open at a time
 * beneath it: the accordion of every stage with every field used to be the
 * widest thing on the page. Selection is the overview's, not this panel's,
 * because clicking a day on the calendar is another way to open its leg.
 *
 * Stages may overlap on purpose: a travel day belongs to the place you left
 * and the one you reached, and `stageAt` gives it to where you ended up.
 */
export default function StagesPanel({
  trip,
  selectedId,
  cursorDate,
  onSelect,
  onOpenStage,
  onScrub,
  onChange,
  timelineSources = [],
  onCompleteFrom,
}: StagesPanelProps) {
  // The ruler's zoom lives here so its control can ride this row instead of
  // costing the track a row of its own beneath it.
  const zoom = useStageZoom({ wheel: 'any' });
  const selectedIndex = trip.stages.findIndex((s) => s.id === selectedId);
  const selected = selectedIndex >= 0 ? trip.stages[selectedIndex] : null;

  function add() {
    // The first day no leg covers, else the trip's end: a new leg starts where
    // the story has a hole, and the ruler's own `+` does the same per gap.
    const gap = rulerGaps(trip, rulerBars(trip))[0];
    const result = startStageAt(trip, gap ? gap.startDate : trip.endDate);
    onChange(result.stages);
    const added = result.stages.find((s) => s.id === result.selectedId);
    if (added) onOpenStage(added);
  }

  return (
    <section
      className="flex flex-col gap-3 bg-surface border border-line rounded-paper-lg p-5"
      aria-label="Stages"
    >
      <div className="flex items-center gap-3">
        <span className={`flex-1 ${legend}`}>
          Stages · {trip.stages.length} leg
          {trip.stages.length === 1 ? '' : 's'}
        </span>
        {/* The timeline of a connected Winnow proposes what this list lacks —
            a diff the author accepts leg by leg, never a sync. */}
        {onCompleteFrom &&
          timelineSources.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onCompleteFrom(id)}
              title={`Compare these stages with ${id}'s timeline and take what you want`}
              className={pill}
            >
              ↓ From {id}
            </button>
          ))}
        <StageZoomControl zoom={zoom} className="flex-none" />
        <button type="button" onClick={add} className={addButton}>
          <span className="font-mono text-[0.95rem] leading-none" aria-hidden="true">
            +
          </span>
          Stage
        </button>
      </div>

      <StageRuler
        trip={trip}
        selectedId={selected?.id ?? null}
        cursorDate={cursorDate}
        onOpenStage={onOpenStage}
        onScrub={onScrub}
        onChange={onChange}
        zoom={zoom}
      />

      {trip.stages.length === 0 ? (
        <p className="m-0 text-[0.8rem] text-muted">
          A stage is a leg of the trip and the days you were on it. Add one
          with the + above, or right-click a day on the calendar, and a badge
          can name it, count the days you stayed, or say which day of the stop
          a picture is. List the places it went through and its name writes
          itself — “Perth → Cairns”.
        </p>
      ) : (
        !selected && (
          <p className="m-0 font-mono text-[0.66rem] text-faint">
            Click a leg to edit it and go to its first day · drag its edges to move its dates · drag the strip above to move through the trip · right-click a day on the calendar to start or end one there
          </p>
        )
      )}

      {selected && (
        <StageCard
          key={selected.id}
          trip={trip}
          stage={selected}
          index={selectedIndex}
          onChange={(next) => onChange(trip.stages.map((s) => (s.id === next.id ? next : s)))}
          onDelete={() => {
            onChange(trip.stages.filter((s) => s.id !== selected.id));
            onSelect(null);
          }}
          onClose={() => onSelect(null)}
        />
      )}
    </section>
  );
}
