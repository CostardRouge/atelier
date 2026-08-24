import { useCallback, useMemo, useState } from 'react';
import { formatIsoDate, type IsoDate } from '../../shared/roadtrip/trip-days';
import { tripCoverage } from '../../shared/roadtrip/trip-coverage';
import type { TripDoc, TripPost, TripStage } from '../../shared/roadtrip/trip-types';
import DayHeatmap from './DayHeatmap';
import DayPanel from './DayPanel';
import StagesPanel from './StagesPanel';

interface TripOverviewProps {
  trip: TripDoc;
  onShowTrips: () => void;
  onChange: (trip: TripDoc) => void;
  /** Open a piece's hook composer. */
  onOpenPost: (post: TripPost) => void;
}

const barPill =
  'inline-flex items-center h-[1.9rem] px-3 rounded-full border whitespace-nowrap';

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[1.35rem] tabular-nums leading-none">{value}</span>
      <span className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted mt-1">
        {label}
      </span>
    </div>
  );
}

/**
 * The trip seen whole: the counts, the grid of its days, and whichever day is
 * open underneath. The grid is the reason the view exists — it answers "what
 * have I never told" at a glance, which is the question a year-old trip and
 * thousands of photos make impossible to answer from memory.
 */
export default function TripOverview({
  trip,
  onShowTrips,
  onChange,
  onOpenPost,
}: TripOverviewProps) {
  const coverage = useMemo(() => tripCoverage(trip), [trip]);
  const [selected, setSelected] = useState<IsoDate | null>(
    () => coverage.days[0]?.date ?? null,
  );

  const selectedCell = useMemo(
    () => coverage.days.find((d) => d.date === selected) ?? null,
    [coverage.days, selected],
  );

  const mutate = useCallback(
    (posts: TripPost[]) => onChange({ ...trip, posts, updatedAt: Date.now() }),
    [trip, onChange],
  );

  const setStages = useCallback(
    (stages: TripStage[]) => onChange({ ...trip, stages, updatedAt: Date.now() }),
    [trip, onChange],
  );

  const untold = coverage.totalDays - coverage.toldDays;

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-5 overflow-auto"
      aria-label={`${trip.name} overview`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onShowTrips}
          className={`${barPill} border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink`}
        >
          ← Trips
        </button>
        <div className="min-w-0">
          <h1 className="m-0 font-serif text-[1.5rem] leading-tight">{trip.name}</h1>
          <p className="m-0 font-mono text-[0.72rem] text-muted">
            {trip.destination && <>{trip.destination} · </>}
            {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-4 bg-surface border border-line rounded-paper-lg p-5">
        <Stat value={String(coverage.totalDays)} label="days on the road" />
        <Stat
          value={`${coverage.toldDays}`}
          label={`days told · ${untold} left`}
        />
        <Stat value={String(coverage.posts)} label="pieces" />
        <Stat value={String(coverage.publishedPosts)} label="published" />
        {coverage.longestGap && (
          <Stat
            value={String(coverage.longestGap.length)}
            label="longest silence"
          />
        )}
      </div>

      <div className="bg-surface border border-line rounded-paper-lg p-5">
        <DayHeatmap
          startDate={trip.startDate}
          endDate={trip.endDate}
          days={coverage.days}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      {coverage.longestGap && (
        <p className="m-0 text-[0.8rem] text-muted">
          The longest stretch nothing has been told from runs{' '}
          <button
            type="button"
            onClick={() => setSelected(coverage.longestGap!.start)}
            className="p-0 border-0 bg-transparent text-accent-ink underline underline-offset-[3px] cursor-pointer font-semibold"
          >
            {formatIsoDate(coverage.longestGap.start)} →{' '}
            {formatIsoDate(coverage.longestGap.end)}
          </button>{' '}
          — {coverage.longestGap.length} days.
        </p>
      )}

      <StagesPanel trip={trip} onChange={setStages} />

      {selected && (
        <DayPanel
          trip={trip}
          date={selected}
          cell={selectedCell}
          onAddPost={(post) => mutate([...trip.posts, post])}
          onUpdatePost={(post) =>
            mutate(trip.posts.map((p) => (p.id === post.id ? post : p)))
          }
          onDeletePost={(id) => mutate(trip.posts.filter((p) => p.id !== id))}
          onOpenPost={onOpenPost}
        />
      )}
    </section>
  );
}
