import { useEffect, useMemo, useState } from 'react';
import { hasImpact, spanImpact, applyTripDetails } from '../../shared/roadtrip/trip-edit';
import { formatIsoDate, spanLength } from '../../shared/roadtrip/trip-days';
import { spanProblem, type TripDoc } from '../../shared/roadtrip/trip-types';
import { DateField } from '../../shared/ui/DateField';
import SectionLegend from '../../shared/ui/SectionLegend';
import { inputClass } from './panels/ui';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/**
 * Trip settings → Name and dates. Everything else in the sheet is written as
 * it is typed; the DATES are the one thing with their own Apply, because a
 * shorter span trims the legs it still covers and drops the ones it no longer
 * reaches — said before it happens, never after (`trip-edit.ts`). Nothing
 * about a piece is ever touched; a piece left outside is only off the
 * calendar. The name is written when the field is left, never blank.
 */
export default function TripDatesSection({ trip, onChange }: { trip: TripDoc; onChange: (trip: TripDoc) => void }) {
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  // An undo or another surface moved the trip under the draft: follow it.
  useEffect(() => setName(trip.name), [trip.name]);
  useEffect(() => {
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
  }, [trip.startDate, trip.endDate]);

  const problem = useMemo(() => spanProblem(startDate, endDate), [startDate, endDate]);
  const length = problem ? null : spanLength(startDate, endDate);
  const moved = startDate !== trip.startDate || endDate !== trip.endDate;
  const impact = useMemo(() => {
    if (problem || !moved) return null;
    const next = spanImpact(trip, startDate, endDate);
    return hasImpact(next) ? next : null;
  }, [trip, problem, moved, startDate, endDate]);

  const commitName = () => {
    const next = name.trim();
    if (!next) setName(trip.name);
    else if (next !== trip.name) onChange({ ...trip, name: next });
  };

  return (
    <>
      <SectionLegend label="Name">
        <p>Short — it is what a badge says over the picture. It is renamed on the overview&apos;s heading too.</p>
      </SectionLegend>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitName();
          }
        }}
        aria-label="Trip name"
        className={`${inputClass} max-w-[24rem] text-base`}
      />

      <SectionLegend label="Dates">
        <p>The dates are what every badge counts from — “day 27”, “515 days ago” are measured off them.</p>
        <p>Legs follow them; pieces are never moved.</p>
      </SectionLegend>
      <div className="grid grid-cols-2 gap-3 max-w-[30rem] max-[420px]:grid-cols-1">
        <label className="flex flex-col gap-1.5">
          <span className={legend}>Left on</span>
          <DateField value={startDate} max={endDate || undefined} onChange={setStartDate} label="Left on" format={formatIsoDate} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={legend}>Came back</span>
          <DateField value={endDate} min={startDate || undefined} onChange={setEndDate} label="Came back" format={formatIsoDate} />
        </label>
      </div>
      <p className={`m-0 text-xs ${problem ? 'text-danger' : 'text-muted'}`} role={problem ? 'alert' : undefined}>
        {problem ?? (length === null ? 'Pick both dates.' : `${length} day${length === 1 ? '' : 's'} — badges read “day n / ${length}”.`)}
      </p>
      {impact && (
        <p className="m-0 max-w-[36rem] px-3.5 py-2.5 border border-accent bg-accent-wash rounded-paper text-xs text-accent-ink" role="status">
          {[
            impact.droppedStages > 0 &&
              `${impact.droppedStages} leg${impact.droppedStages === 1 ? '' : 's'} fall${impact.droppedStages === 1 ? 's' : ''} outside these dates and will be removed`,
            impact.trimmedStages > 0 && `${impact.trimmedStages} leg${impact.trimmedStages === 1 ? '' : 's'} will be trimmed to fit`,
            impact.strandedPosts > 0 &&
              `${impact.strandedPosts} piece${impact.strandedPosts === 1 ? '' : 's'} would sit outside the trip — kept, but no longer on the calendar`,
          ]
            .filter(Boolean)
            .join(' · ')}
          .
        </p>
      )}
      {moved && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!!problem}
            onClick={() => onChange(applyTripDetails(trip, { startDate, endDate }))}
            className="h-[2.1rem] px-[1.1rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-sm font-semibold hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply the new dates
          </button>
          <button
            type="button"
            onClick={() => {
              setStartDate(trip.startDate);
              setEndDate(trip.endDate);
            }}
            className="p-0 border-0 bg-transparent text-sm text-muted cursor-pointer hover:text-ink"
          >
            Keep {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
          </button>
        </div>
      )}
    </>
  );
}
