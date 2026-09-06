import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { formatIsoDate, spanLength } from '../../shared/roadtrip/trip-days';
import { tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { createTripDoc, type TripDoc } from '../../shared/roadtrip/trip-types';
import {
  TRIP_FILE_ACCEPT,
  TRIP_FILE_EXTENSION,
  parseTripFile,
  serializeTripFile,
  toTripFile,
  tripDocFromFile,
  tripFileName,
} from '../../shared/roadtrip/trip-file';
import { pickFile } from '../../shared/sources/file-sources';
import {
  DEFAULT_SOURCE_ID,
  groupBySource,
  listSources,
  sourceById,
  type SourceInfo,
} from '../../shared/sources/source';
import {
  listWinnowConnections,
  subscribeWinnowConnections,
} from '../../shared/sources/winnow/store';
import { downloadBlob } from '../../shared/media/save';
import {
  deleteThumbs,
  deleteTrip,
  listTrips,
  putTrip,
} from '../../shared/roadtrip/trip-store';
import NewTripModal, { type NewTripChoices } from './NewTripModal';

interface TripGalleryProps {
  openTripId: string | null;
  onOpen: (trip: TripDoc) => void;
}

/**
 * The sources that can HOLD a trip: this browser, plus every connected
 * instance whose capabilities say it has a document bucket. The connection
 * list is the argument only so a memo re-runs when a connection comes or
 * goes — `listSources()` is the store's mirror and reads nothing itself.
 */
function documentSourcesFor(connections: readonly unknown[]): SourceInfo[] {
  void connections;
  return listSources().filter((s) => s.capabilities.documents);
}

function TripCard({
  trip,
  isOpen,
  onOpen,
  onExport,
  onDelete,
}: {
  trip: TripDoc;
  isOpen: boolean;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const coverage = tripCoverage(trip);
  const total = spanLength(trip.startDate, trip.endDate) ?? 0;
  const pct = total > 0 ? Math.round((coverage.toldDays / total) * 100) : 0;

  return (
    <div
      className={`flex flex-col gap-3 p-5 bg-surface border rounded-paper-lg shadow-paper-soft transition-[transform,box-shadow,border-color] duration-300 ease-paper hover:-translate-y-1 hover:shadow-paper ${
        isOpen ? 'border-accent' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="min-w-0">
        <h3 className="m-0 font-serif text-[1.2rem] truncate" title={trip.name}>
          {trip.name}
        </h3>
        <p className="m-0 font-mono text-[0.68rem] text-muted truncate">
          {trip.destination || 'No destination set'}
        </p>
      </div>

      <p className="m-0 font-mono text-[0.7rem] tabular-nums text-muted">
        {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
        <span className="text-faint"> · </span>
        {total} day{total === 1 ? '' : 's'}
      </p>

      {/* Progress reads as "how much of the trip has been told", which is the
          number the maintainer actually tracks — not how many files exist. */}
      <div>
        <div className="h-[6px] rounded-full bg-paper-2 overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-500 ease-paper"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="m-0 mt-1.5 font-mono text-[0.66rem] text-muted tabular-nums">
          {coverage.toldDays}/{total} days told
          <span className="text-faint"> · </span>
          {coverage.publishedPosts} published
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onOpen}
          className="px-3.5 py-[0.45rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.78rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
        >
          {isOpen ? 'Resume' : 'Open'}
        </button>
        <span className="flex-1" />
        {!confirming && (
          <button
            type="button"
            onClick={onExport}
            className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-accent-ink"
            title={`Save the whole trip as a ${TRIP_FILE_EXTENSION} file`}
          >
            Export
          </button>
        )}
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
            aria-label={`Delete ${trip.name}`}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The tool's front door: the trips, newest first, each showing how much of it
 * has been told. Deleting is a two-step confirm inside the card — the same
 * pattern as the studio gallery, no modal.
 */
export default function TripGallery({ openTripId, onOpen }: TripGalleryProps) {
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listTrips().then(setTrips);
  }, []);

  useEffect(refresh, [refresh]);

  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const documentSources = useMemo(
    () => documentSourcesFor(connections),
    [connections],
  );
  // Where an imported file lands. Only offered when there is a choice.
  const [importTarget, setImportTarget] = useState(DEFAULT_SOURCE_ID);

  async function handleCreate(choices: NewTripChoices) {
    const doc = createTripDoc(
      choices.name,
      choices.destination,
      choices.startDate,
      choices.endDate,
      choices.places,
      choices.sourceId,
    );
    await putTrip(doc);
    setCreating(false);
    onOpen(doc);
  }

  /** The whole trip on disk — a backup, and how it reaches another machine. */
  function handleExport(trip: TripDoc) {
    downloadBlob(
      new Blob([serializeTripFile(toTripFile(trip))], { type: 'application/json' }),
      tripFileName(trip.name),
    );
  }

  /**
   * A trip file always becomes a NEW trip, never an overwrite: importing the
   * same backup twice must not silently replace the trip you have been telling
   * for months. Merging two trips is not a thing this offers, deliberately.
   */
  async function handleImport() {
    const picked = await pickFile(TRIP_FILE_ACCEPT);
    if (!picked) return;
    setImportError(null);
    const parsed = parseTripFile(await picked.text());
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    const target = documentSources.some((s) => s.id === importTarget)
      ? importTarget
      : DEFAULT_SOURCE_ID;
    const doc = tripDocFromFile(parsed.file, Date.now(), target);
    if (!doc.name.trim()) {
      doc.name = picked.name.replace(/\.(roadtrip\.)?json$/i, '') || 'Imported trip';
    }
    await putTrip(doc);
    refresh();
  }

  async function handleDelete(id: string) {
    // The hooks go with the trip: nothing else will ever prune them, and they
    // are the only heavy values in the database.
    const doomed = trips?.find((t) => t.id === id);
    await deleteTrip(id);
    if (doomed) await deleteThumbs(doomed.posts.map((p) => p.id));
    refresh();
  }

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-5 overflow-auto"
      aria-label="Road trips"
    >
      <div className="flex items-center gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="m-0 font-serif text-[1.6rem] leading-tight">Trips</h1>
          <p className="m-0 text-[0.84rem] text-muted">
            A trip is its dates — everything a badge counts from, and the grid
            of days you still have to tell.
          </p>
        </div>
        <span className="flex-1" />
        {documentSources.length > 1 && (
          <label className="inline-flex items-center gap-2 font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted">
            import to
            <select
              value={importTarget}
              onChange={(e) => setImportTarget(e.target.value)}
              className="font-sans normal-case tracking-normal text-[0.8rem] px-2.5 py-1 border border-line rounded-full bg-paper text-ink focus:outline-none focus:border-accent"
              aria-label="Where an imported trip is kept"
            >
              {documentSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === DEFAULT_SOURCE_ID ? 'this browser' : s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => void handleImport()}
          className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-line-strong rounded-full bg-paper text-ink-soft cursor-pointer text-[0.84rem] transition-colors hover:border-accent hover:text-accent-ink"
          title={`Create a trip from an exported file (${TRIP_FILE_EXTENSION})`}
        >
          ↑ Import a trip file
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent active:scale-[0.98]"
        >
          + New trip
        </button>
      </div>

      {importError && (
        <p className="m-0 text-[0.8rem] text-[#9a3a23]" role="alert">
          {importError}
        </p>
      )}

      {trips === null ? (
        <p className="m-0 text-[0.85rem] text-muted font-mono">Loading trips…</p>
      ) : trips.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-[44ch] flex flex-col items-center gap-3 border border-dashed border-line-strong rounded-paper-lg px-8 py-10">
            <p className="m-0 font-serif text-[1.25rem]">No trips yet</p>
            <p className="m-0 text-[0.85rem] text-muted leading-relaxed">
              Give a trip its two dates and every photo you post from it knows
              which day it belongs to — and the grid shows the days you have
              never told.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent"
            >
              Create the first one
            </button>
          </div>
        </div>
      ) : (
        // Grouped by provenance — one group per source, `local` first, even
        // while local is the only one: the studio gallery's own shape, so a
        // trip kept on a Winnow lands in its own section instead of reshaping
        // this page. A source this session does not know still shows its
        // trips, with the reason — never hidden.
        <div className="flex flex-col gap-6 pb-4">
          {groupBySource(trips).map(({ id, items }) => {
            const source = sourceById(id);
            return (
              <section key={id} aria-label={`Trips from ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-[0.66rem] tracking-[0.14em] uppercase text-muted">
                  source: {source?.label ?? id}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">
                    {items.length} trip{items.length === 1 ? '' : 's'}
                  </span>
                  {!source && (
                    <span className="text-faint">
                      {' '}
                      · not connected — showing what this device holds
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
                  {items.map((trip) => (
                    <TripCard
                      key={trip.id}
                      trip={trip}
                      isOpen={trip.id === openTripId}
                      onOpen={() => onOpen(trip)}
                      onExport={() => handleExport(trip)}
                      onDelete={() => void handleDelete(trip.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {creating && (
        <NewTripModal
          sources={documentSources}
          onCancel={() => setCreating(false)}
          onCreate={(choices) => void handleCreate(choices)}
        />
      )}
    </section>
  );
}
