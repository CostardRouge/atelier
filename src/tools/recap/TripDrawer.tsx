import { useMemo, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { coverWord, isGivenTrip, orderTrips, tripFacts, tripMeta, tripSpan, tripStale, type OpenerTrip } from '../../shared/recap/recap-opener-trip';
import { TRIP_FILE_ACCEPT, TRIP_FILE_EXTENSION } from '../../shared/roadtrip/trip-file';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { pickFile } from '../../shared/sources/file-sources';
import { Icons } from '../../shared/ui/icons';
import { PRESS_LOOK } from '../../shared/ui/press';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import TripThumb from './TripThumb';

const CARD = `relative min-w-0 flex flex-col gap-1 p-1 pb-1.5 rounded-control border text-left font-sans cursor-pointer select-none transition-[background-color,box-shadow,border-color,translate] duration-150 ease-paper ${PRESS_LOOK} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`;
const PILL = 'absolute top-2 left-2 z-[1] px-1.5 py-px rounded-full font-mono text-3xs tracking-[0.06em] uppercase text-on-media';

/**
 * The trip an opener drives, chosen from a MINI DRAWER of thumbnails (lab 16,
 * his «go» of 2026-11-10): the trips of Trips on this device as cards — the
 * ones covering the recap's days first, marked — and a dashed tile that takes
 * a `.roadtrip.json` (dropped anywhere on the drawer, or chosen).
 *
 * It rises from the inspector's foot and leaves the stage uncovered: a card
 * clicked IS the import (↶ takes it back), the stage shows the opener over
 * that trip at once, and another can be tried without closing. Under the
 * stage on a phone, with no wash over it (`frontend.md`, sheet vs drawer: the
 * effect is watched). Nothing is fetched: the list is Trips' own store, the
 * file is read here.
 */
export default function TripDrawer({
  host,
  trips,
  covers,
  days,
  current,
  onPick,
  onImport,
  onNone,
  onClose,
}: {
  /** The inspector's block, which the drawer rises in; absent, it is the screen's foot. */
  host: HTMLElement | null;
  trips: readonly TripDoc[];
  covers: ReadonlyMap<string, string>;
  days: readonly string[];
  /** The copy the recap keeps now. */
  current: OpenerTrip | null;
  onPick: (trip: TripDoc) => void;
  /** Read a file's text as a trip: an error to say, or null once it is the recap's. */
  onImport: (text: string, name: string) => string | null;
  onNone: () => void;
  onClose: () => void;
}) {
  useDialogKeys({ onCancel: onClose });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const listed = useMemo(() => orderTrips(trips, days), [trips, days]);
  const word = useMemo(() => coverWord(days), [days]);
  const currentId = current?.from.kind === 'trips' ? current.from.id : null;
  const stale = tripStale(current, trips);
  // A copy whose trip is not listed — read from a file, or its trip gone from this device since — leads, as what it is.
  const loose = isGivenTrip(current) && !trips.some((t) => t.id === currentId) ? current : null;

  const read = async (file: File | null | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError('That file could not be read.');
      return;
    }
    setError(onImport(text, file.name));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void read(e.dataTransfer.files?.[0]);
  };

  const body = (
    <>
      {/* A wash over the inspector only — never over the stage, which shows the trip chosen. */}
      <div className="hidden @min-[860px]:block absolute inset-0 z-[5] rounded-paper bg-[rgba(20,18,15,0.38)]" onPointerDown={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Trip for the opener"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`fixed inset-x-0 bottom-0 z-40 max-h-[calc(var(--app-h,100dvh)*0.58)] pb-[env(safe-area-inset-bottom,0px)] @min-[860px]:absolute @min-[860px]:z-[6] @min-[860px]:max-h-[82%] @min-[860px]:pb-0 flex flex-col bg-surface border-t border-line-strong rounded-t-paper-lg @min-[860px]:rounded-b-paper shadow-paper ${over ? 'outline outline-2 -outline-offset-2 outline-accent' : ''}`}
      >
        <span className="flex-none self-center w-9 h-1 mt-1.5 rounded-full bg-line-strong" aria-hidden="true" />
        <header className="flex-none flex items-center gap-2 pl-3.5 pr-1">
          <h3 className="m-0 flex-1 min-w-0 font-serif text-xl leading-tight truncate">Trip for the opener</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-none grid place-items-center w-11 h-11 p-0 border-0 bg-transparent rounded-full text-ink-soft cursor-pointer hover:text-ink focus-visible:outline-2 focus-visible:outline-accent [&>svg]:w-4 [&>svg]:h-4"
          >
            {Icons.close}
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin] px-3.5 pb-3 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {loose && (
              <span className={`${CARD} border-accent bg-surface shadow-[0_0_0_1px_var(--color-accent)] cursor-default`} aria-current="true">
                <span className={`${PILL} bg-[rgba(16,14,12,0.62)]`}>{loose.from.kind === 'file' ? 'file' : 'kept here'}</span>
                <Tick />
                <TripThumb trip={loose.file} />
                <Words name={loose.file.name} line={`${tripSpan(loose.file.startDate, loose.file.endDate)} · ${tripMeta(tripFacts(loose.file))}`} />
              </span>
            )}
            {listed.map(({ trip, covers: covering }) => {
              const chosen = trip.id === currentId;
              const refresh = chosen && stale;
              return (
                <button
                  key={trip.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => {
                    setError(null);
                    onPick(trip);
                  }}
                  title={refresh ? 'Changed in Trips since it was copied — take it again' : chosen ? 'The trip this recap keeps a copy of' : 'Copy this trip into the recap'}
                  className={`${CARD} ${chosen ? 'border-accent bg-surface shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line bg-paper-2 hover:border-line-strong'}`}
                >
                  {refresh ? <span className={`${PILL} bg-[rgba(16,14,12,0.62)]`}>updated in Trips ↻</span> : covering ? <span className={`${PILL} bg-ok`}>{word} ✓</span> : null}
                  {chosen && <Tick />}
                  <TripThumb trip={trip} cover={covers.get(trip.id) ?? null} />
                  <Words name={trip.name} line={`${tripSpan(trip.startDate, trip.endDate)} · ${tripMeta(tripFacts(trip))}`} />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => void pickFile(TRIP_FILE_ACCEPT).then(read)}
              className={`${CARD} items-center justify-center gap-0.5 min-h-[6.5rem] text-center border-dashed border-line-strong bg-transparent text-ink-soft hover:border-accent hover:text-ink`}
            >
              <b className="text-xs font-semibold">+ {TRIP_FILE_EXTENSION}</b>
              <small className="font-mono text-3xs text-muted">drop it, or choose a file</small>
            </button>
          </div>
          {error && (
            <p role="alert" className="m-0 px-2.5 py-1.5 rounded-control bg-danger-wash text-xs text-danger-ink">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span className="min-w-0 truncate">Kept with this recap, on this device</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                onNone();
              }}
              disabled={!isGivenTrip(current)}
              className="flex-none min-h-11 px-1 border-0 bg-transparent text-xs text-ink-soft underline underline-offset-[3px] cursor-pointer hover:text-accent-ink disabled:opacity-40 disabled:cursor-default disabled:no-underline"
            >
              Use no trip
            </button>
          </div>
        </div>
      </div>
    </>
  );
  return host ? createPortal(body, host) : body;
}

function Tick() {
  return (
    <span className="absolute top-2 right-2 z-[1] grid place-items-center w-[1.15rem] h-[1.15rem] rounded-full bg-accent text-on-media [&>svg]:w-3 [&>svg]:h-3" aria-hidden="true">
      {Icons.check}
    </span>
  );
}

function Words({ name, line }: { name: string; line: string }) {
  return (
    <>
      <span className="px-1 text-xs font-semibold text-ink truncate">{name || 'Untitled trip'}</span>
      <span className="px-1 font-mono text-3xs text-muted truncate" title={line}>
        {line}
      </span>
    </>
  );
}
