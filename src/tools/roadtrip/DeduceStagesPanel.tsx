import { useEffect, useMemo, useState } from 'react';
import { WinnowClient, WinnowError } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import { readDayTrack, type DayTrack } from '../../shared/roadtrip/day-track';
import {
  segmentTrack,
  DEFAULT_SEGMENT,
  type SegmentOptions,
} from '../../shared/roadtrip/segment-track';
import { chaptersOf, doubtful, trackChapters } from '../../shared/roadtrip/track-chapters';
import type { GazetteerCity } from '../../shared/roadtrip/gazetteer';
import { gazetteerOrEmpty } from '../../shared/roadtrip/load-gazetteer';
import {
  applyTimelineDiff,
  diffTimeline,
  importTimeline,
  type DiffEntry,
} from '../../shared/roadtrip/timeline-import';
import { spanLength } from '../../shared/roadtrip/trip-days';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import Segmented from '../../shared/ui/Segmented';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import StageDiffList, {
  actionableOf,
  defaultAccepted,
  toggle,
} from './StageDiffList';

/**
 * Work the trip's legs out from one position per day, and offer them.
 *
 * Why this is not `TimelineImportPanel` with a switch: that panel reads an
 * instance's own chapters and is asleep behind `TIMELINE_SYNC_ENABLED`, which
 * is off because Winnow's timeline is young. Entangling a live feature with a
 * dormant one would blur what that switch means. What the two DO share is the
 * list of proposals, extracted to `StageDiffList` the day this became its
 * second consumer — and, underneath, every line of the arithmetic:
 * `timeline-import.ts` does not care whether a chapter was read off a timeline
 * or deduced here.
 *
 * Nothing here goes behind that switch. The deduction asks for positions over
 * a DATE RANGE, like the day view and `DayFromWinnow` — the rule
 * `roadtrip.md` states as «never put a media-reaching feature behind this
 * switch».
 *
 * **One request, and one only.** `geo?by=day` answers the whole question,
 * declared gaps included, so moving a slider recomputes from the days already
 * read and never asks the instance again.
 */

interface DeduceStagesPanelProps {
  connection: WinnowConnection;
  trip: TripDoc;
  onCancel: () => void;
  onApply: (trip: TripDoc, spanWidened: boolean) => void;
}

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const note = 'text-2xs text-faint leading-snug';

/* ---- settings, remembered on this machine ------------------------------ */
// The convention the repo already follows for a render preference: a
// module-level key, a read in try/catch, a lazy `useState`, a write in
// try/catch. NEVER on the document — a `.roadtrip.json` does not carry how
// one machine was being driven.
const KEY = 'atelier.roadtrip.deduce';

type Stored = Pick<SegmentOptions, 'radiusKm' | 'minNights' | 'shortLegs' | 'bridgeBlind' | 'interpolateMoves'>;

function readStored(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SEGMENT;
    const saved = JSON.parse(raw) as Partial<Stored>;
    return {
      radiusKm:
        typeof saved.radiusKm === 'number' && saved.radiusKm > 0
          ? saved.radiusKm
          : DEFAULT_SEGMENT.radiusKm,
      minNights:
        typeof saved.minNights === 'number' && saved.minNights >= 1
          ? Math.round(saved.minNights)
          : DEFAULT_SEGMENT.minNights,
      shortLegs: saved.shortLegs === 'merge' ? 'merge' : 'list',
      bridgeBlind: saved.bridgeBlind !== false,
      interpolateMoves: saved.interpolateMoves === true,
    };
  } catch {
    return DEFAULT_SEGMENT;
  }
}

function explain(err: unknown, client: WinnowClient): { text: string; login?: string } {
  if (err instanceof WinnowError && err.kind === 'unauthenticated') {
    return { text: `Not signed in to ${client.config.baseUrl}.`, login: client.loginUrl() };
  }
  if (err instanceof WinnowError && err.kind === 'notfound') {
    return {
      text: `${client.config.baseUrl} cannot answer for a day's position yet — it is too old for this.`,
    };
  }
  return { text: err instanceof Error ? err.message : String(err) };
}

export default function DeduceStagesPanel({
  connection,
  trip,
  onCancel,
  onApply,
}: DeduceStagesPanelProps) {
  const client = useMemo(
    () => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }),
    [connection.baseUrl, connection.auth],
  );

  const [opts, setOpts] = useState<Stored>(readStored);
  const [track, setTrack] = useState<DayTrack | null>(null);
  const [cities, setCities] = useState<GazetteerCity[] | null>(null);
  const [problem, setProblem] = useState<{ text: string; login?: string } | null>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<string> | null>(null);

  function change(next: Partial<Stored>) {
    const merged = { ...opts, ...next };
    setOpts(merged);
    // A new setting is a new set of legs, so the old ticks name rows that may
    // not exist any more: fall back to the defaults rather than carry them.
    setAccepted(null);
    try {
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      // A machine that refuses storage still honours the choice this session.
    }
  }

  // One request, on open. The city index comes with it and is allowed to fail:
  // a leg with no name still has its dates.
  useEffect(() => {
    let cancelled = false;
    setTrack(null);
    setProblem(null);
    client
      .geoDays({ from: trip.startDate, to: trip.endDate })
      .then((rows) => {
        if (!cancelled) setTrack(readDayTrack(rows));
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      });
    gazetteerOrEmpty().then((list) => {
      if (!cancelled) setCities(list);
    });
    return () => {
      cancelled = true;
    };
  }, [client, trip.startDate, trip.endDate]);

  // ONE pass over the days: the proposals, and the producer's own doubt about
  // some of them. Deriving the two separately would mean segmenting twice and
  // is exactly how the marks and the rows start disagreeing.
  const { entries, held } = useMemo<{ entries: DiffEntry[]; held: Set<string> }>(() => {
    if (!track || cities === null) return { entries: [], held: new Set() };

    const { legs } = segmentTrack(track.points, opts);
    const proposed = trackChapters(legs, cities);
    const imported = importTimeline(chaptersOf(proposed), {
      sourceId: connection.id,
      importedAt: Date.now(),
    });

    return {
      entries: diffTimeline(trip, imported, connection.id),
      // `diffTimeline` keys an incoming leg `chapter:<its chapter id>`.
      held: new Set([...doubtful(proposed)].map((id) => `chapter:${id}`)),
    };
  }, [track, cities, opts, trip, connection.id]);

  const ticked = accepted ?? defaultAccepted(entries, held);
  const actionable = actionableOf(entries);
  const tickedActionable = [...ticked].filter((k) => actionable.some((e) => e.key === k)).length;

  function apply() {
    const result = applyTimelineDiff(trip, entries, ticked);
    onApply(result.trip, result.spanWidened);
  }

  const canGo = entries.length > 0 && tickedActionable > 0;
  useDialogKeys({ onCancel, onConfirm: canGo ? apply : null });

  const title = `Deduce the itinerary from ${connection.id}`;
  const totalDays = spanLength(trip.startDate, trip.endDate) ?? 0;
  const placed = track?.points.length ?? 0;
  const blind = track?.blind.length ?? 0;

  /** The word a row carries under its sentence, when it carries one. */
  function noteFor(entry: DiffEntry): string | null {
    if (!held.has(entry.key)) return null;
    return 'left unticked — a short stop, or placed only from guessed positions';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[40rem] max-h-[90dvh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 max-[820px]:max-w-none max-[820px]:max-h-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:px-4 max-[820px]:pt-4">
        <div>
          <h2 className="m-0 font-serif text-2xl">{title}</h2>
          <p className="m-0 mt-1 text-sm text-muted">
            One position per day is enough to work the legs out — no picture is fetched.
            Nothing changes until you tick it, and no post is ever created.
          </p>
        </div>

        {problem ? (
          <p className="m-0 text-sm text-danger" role="alert">
            {problem.text}{' '}
            {problem.login && (
              <a
                className="font-semibold underline underline-offset-[3px]"
                href={problem.login}
                target="_blank"
                rel="noreferrer"
              >
                Sign in there
              </a>
            )}
          </p>
        ) : track === null || cities === null ? (
          <p className="m-0 font-mono text-xs text-muted">asking {connection.id}…</p>
        ) : (
          <>
            {/* --- what this trip really holds, before any proposal -------- */}
            <p className="m-0 font-mono text-xs text-muted tabular-nums">
              {totalDays} day{totalDays === 1 ? '' : 's'} · {placed} placed · {blind} with media
              and no position
              {cities.length === 0 && ' · no city index, so legs arrive unnamed'}
            </p>

            {/* --- the settings -------------------------------------------- */}
            <div className="flex flex-col gap-3.5">
              <label className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={legend}>Radius of one halt</span>
                  <span className="font-mono text-xs text-accent-ink tabular-nums">
                    {opts.radiusKm} km
                  </span>
                </span>
                <input
                  type="range"
                  min={5}
                  max={120}
                  step={5}
                  value={opts.radiusKm}
                  onChange={(e) => change({ radiusKm: Number(e.target.value) })}
                  className="w-full accent-accent"
                />
                <span className={note}>
                  Two days this close are the same place. Beyond it, you drove.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={legend}>A halt is at least</span>
                  <span className="font-mono text-xs text-accent-ink tabular-nums">
                    {opts.minNights} day{opts.minNights === 1 ? '' : 's'}
                  </span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={6}
                  step={1}
                  value={opts.minNights}
                  onChange={(e) => change({ minNights: Number(e.target.value) })}
                  className="w-full accent-accent"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className={legend}>Shorter than that</span>
                <Segmented
                  fill
                  label="What to do with a short halt"
                  value={opts.shortLegs}
                  onChange={(id) => change({ shortLegs: id })}
                  options={[
                    { id: 'list', label: 'List it', title: 'A leg of its own, marked and left unticked' },
                    { id: 'merge', label: 'Fold it in', title: 'Into the halt it was on the way to' },
                  ]}
                />
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-[3px] w-[15px] h-[15px] accent-ink flex-none"
                  checked={opts.bridgeBlind}
                  onChange={(e) => change({ bridgeBlind: e.target.checked })}
                />
                <span className="min-w-0">
                  <span className="block text-sm">Cover a blind day between two days in one place</span>
                  <span className={note}>Nothing invented — a leg is a span.</span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-[3px] w-[15px] h-[15px] accent-ink flex-none"
                  checked={opts.interpolateMoves}
                  onChange={(e) => change({ interpolateMoves: e.target.checked })}
                />
                <span className="min-w-0">
                  <span className="block text-sm">Invent the days of a move</span>
                  <span className={note}>
                    A guess between two places — off, and what it makes is marked.
                  </span>
                </span>
              </label>
            </div>

            {/* --- the proposals -------------------------------------------- */}
            {entries.length === 0 ? (
              <p className="m-0 text-sm text-muted">
                {placed === 0
                  ? 'No day of this trip carries a position, so there is no itinerary to work out.'
                  : 'These settings produce no leg — try a wider radius.'}
              </p>
            ) : actionable.length === 0 ? (
              <p className="m-0 text-sm text-muted">
                Your trip already matches what the days say — {entries.length} leg
                {entries.length === 1 ? '' : 's'}, nothing to change.
              </p>
            ) : (
              <StageDiffList
                entries={entries}
                ticked={ticked}
                onToggle={(key) => setAccepted(toggle(ticked, key))}
                noteFor={noteFor}
              />
            )}
          </>
        )}

        <div className="sticky bottom-0 -mx-6 mt-auto px-6 pb-6 flex items-center justify-end gap-4 pt-1 border-t border-line bg-surface max-[820px]:-mx-4 max-[820px]:px-4 max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-sm text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!canGo}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-sm font-semibold hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Accept {tickedActionable || ''}
          </button>
        </div>
      </div>
    </div>
  );
}
