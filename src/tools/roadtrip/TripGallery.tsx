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
  deleteSyncRecord,
  deleteThumbs,
  deleteTrip,
  getSyncRecord,
  listTrips,
  putTrip,
} from '../../shared/roadtrip/trip-store';
import {
  deleteRemoteTrip,
  explainFailure,
  failureOf,
  isRemoteSource,
  listRemoteTrips,
  mirrorTrip,
  moveTrip,
  pushTrip,
  remoteFor,
  type RemoteTripRow,
} from '../../shared/roadtrip/trip-remote';
import NewTripModal, { type NewTripChoices, type TimelineSourceOption } from './NewTripModal';

interface TripGalleryProps {
  openTripId: string | null;
  onOpen: (trip: TripDoc) => void;
  /** Connected Winnows the New trip modal may offer as a seed. */
  timelineSources?: TimelineSourceOption[];
  onSeedFrom?: (sourceId: string) => void;
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

/** What this device knows about one instance's list of trips. */
type RemoteList =
  | { status: 'loading' }
  | { status: 'ok'; rows: RemoteTripRow[] }
  | { status: 'failed'; text: string; login?: string };

function sourceLabel(id: string): string {
  return id === DEFAULT_SOURCE_ID ? 'this browser' : (sourceById(id)?.label ?? id);
}

function TripCard({
  trip,
  isOpen,
  remoteOnly,
  moveTargets,
  busy,
  onOpen,
  onExport,
  onDelete,
  onMove,
}: {
  trip: TripDoc;
  isOpen: boolean;
  /** Kept on an instance and not yet mirrored here: opening pulls it first. */
  remoteOnly: boolean;
  /** The other sources this trip could be moved to. */
  moveTargets: readonly SourceInfo[];
  /** A sentence while a move or a delete is under way, or null. */
  busy: string | null;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove: (targetSourceId: string) => void;
}) {
  const [confirming, setConfirming] = useState<'delete' | 'move' | null>(null);
  const [moveTo, setMoveTo] = useState(moveTargets[0]?.id ?? '');
  const coverage = tripCoverage(trip);
  const total = spanLength(trip.startDate, trip.endDate) ?? 0;
  const pct = total > 0 ? Math.round((coverage.toldDays / total) * 100) : 0;

  return (
    <div
      className={`flex flex-col gap-3 p-5 bg-surface border rounded-paper-lg shadow-paper-soft transition-[transform,box-shadow,border-color] duration-300 ease-paper hover:-translate-y-1 hover:shadow-paper ${
        isOpen ? 'border-accent' : 'border-line hover:border-line-strong'
      } ${remoteOnly ? 'opacity-75' : ''}`}
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

      {remoteOnly && (
        <p className="m-0 font-mono text-[0.66rem] text-faint">
          on {sourceLabel(trip.sourceId)} · not yet on this device
        </p>
      )}
      {busy && (
        <p className="m-0 font-mono text-[0.66rem] text-muted" role="status">
          {busy}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <button
          type="button"
          onClick={onOpen}
          disabled={busy !== null}
          className="px-3.5 py-[0.45rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.78rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent disabled:opacity-50"
        >
          {isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open'}
        </button>
        <span className="flex-1" />
        {confirming === null && (
          <>
            <button
              type="button"
              onClick={onExport}
              className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-accent-ink"
              title={`Save the whole trip as a ${TRIP_FILE_EXTENSION} file`}
            >
              Export
            </button>
            {moveTargets.length > 0 && !remoteOnly && (
              <button
                type="button"
                onClick={() => setConfirming('move')}
                className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-accent-ink"
                title="Keep this trip on another source"
              >
                Move…
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirming('delete')}
              className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-[#9a3a23]"
              aria-label={`Delete ${trip.name}`}
            >
              Delete
            </button>
          </>
        )}
        {confirming === 'delete' && (
          <span className="flex items-center gap-2 text-[0.75rem]">
            <button
              type="button"
              onClick={() => {
                setConfirming(null);
                onDelete();
              }}
              className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="p-0 border-0 bg-transparent text-muted cursor-pointer"
            >
              Keep
            </button>
          </span>
        )}
        {confirming === 'move' && (
          <span className="flex items-center gap-2 text-[0.75rem] flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-muted">
              to
              <select
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                className="font-sans text-[0.75rem] px-2 py-0.5 border border-line rounded-full bg-paper text-ink focus:outline-none focus:border-accent"
                aria-label="Move this trip to"
              >
                {moveTargets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sourceLabel(s.id)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setConfirming(null);
                if (moveTo) onMove(moveTo);
              }}
              className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px]"
            >
              Move
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="p-0 border-0 bg-transparent text-muted cursor-pointer"
            >
              Cancel
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The tool's front door: the trips, grouped by the source they are kept on,
 * each showing how much of it has been told. Deleting is a two-step confirm
 * inside the card — the same pattern as the studio gallery, no modal.
 *
 * A connected instance's list is asked for beside the local one and merged
 * by id: a trip mirrored here is one card, a trip only there is a greyed
 * card that pulls on open. While the instance answers, the mirrored ones
 * show with "checking…"; when it cannot, the header says so and the mirrors
 * stay — never hidden.
 */
export default function TripGallery({
  openTripId,
  onOpen,
  timelineSources,
  onSeedFrom,
}: TripGalleryProps) {
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteLists, setRemoteLists] = useState<Record<string, RemoteList>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});

  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const documentSources = useMemo(() => documentSourcesFor(connections), [connections]);
  const remoteSourceIds = useMemo(
    () => documentSources.filter((s) => isRemoteSource(s.id)).map((s) => s.id),
    [documentSources],
  );
  // Where an imported file lands. Only offered when there is a choice.
  const [importTarget, setImportTarget] = useState(DEFAULT_SOURCE_ID);

  const refresh = useCallback(() => {
    void listTrips().then(setTrips);
    for (const id of remoteSourceIds) {
      const remote = remoteFor(id);
      if (!remote) continue;
      setRemoteLists((cur) => ({ ...cur, [id]: { status: 'loading' } }));
      void listRemoteTrips(remote).then(
        (rows) => setRemoteLists((cur) => ({ ...cur, [id]: { status: 'ok', rows } })),
        (err: unknown) => {
          const e = explainFailure(failureOf(err), remote);
          setRemoteLists((cur) => ({ ...cur, [id]: { status: 'failed', ...e } }));
        },
      );
    }
  }, [remoteSourceIds]);

  useEffect(refresh, [refresh]);

  const setBusyFor = (id: string, text: string | null) =>
    setBusy((cur) => {
      const next = { ...cur };
      if (text === null) delete next[id];
      else next[id] = text;
      return next;
    });

  /**
   * A trip on an instance is written THERE first — one gesture, one request,
   * the result said. Nothing is kept here if the instance refused.
   */
  async function createOn(doc: TripDoc, verb: string): Promise<boolean> {
    if (!isRemoteSource(doc.sourceId)) {
      await putTrip(doc);
      return true;
    }
    const remote = remoteFor(doc.sourceId);
    if (!remote) {
      setNotice(`${doc.sourceId} is not connected — nothing was ${verb}.`);
      return false;
    }
    const rec = await pushTrip(remote, doc, null);
    if (rec.status !== 'synced') {
      await deleteSyncRecord(doc.id);
      const why = rec.error ? `: ${rec.error}` : '';
      setNotice(`Could not save to ${remote.label}${why} — nothing was ${verb}.`);
      return false;
    }
    await putTrip(doc);
    return true;
  }

  async function handleCreate(choices: NewTripChoices) {
    setNotice(null);
    const doc = createTripDoc(
      choices.name,
      choices.destination,
      choices.startDate,
      choices.endDate,
      choices.places,
      choices.sourceId,
    );
    setCreating(false);
    if (await createOn(doc, 'created')) onOpen(doc);
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
    setNotice(null);
    const parsed = parseTripFile(await picked.text());
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    const target = documentSources.some((s) => s.id === importTarget)
      ? importTarget
      : DEFAULT_SOURCE_ID;
    const doc = tripDocFromFile(parsed.file, Date.now(), target);
    if (!doc.name.trim()) {
      doc.name = picked.name.replace(/\.(roadtrip\.)?json$/i, '') || 'Imported trip';
    }
    if (await createOn(doc, 'imported')) refresh();
  }

  /**
   * Delete here, and there when the trip is kept on an instance — guarded
   * by the revision this device holds, and refused while the instance cannot
   * be reached: a delete that lands later is a tombstone, and there are none.
   */
  async function handleDelete(trip: TripDoc, etagHint: string | null) {
    setNotice(null);
    if (isRemoteSource(trip.sourceId)) {
      const remote = remoteFor(trip.sourceId);
      if (!remote) {
        setNotice(`Connect ${trip.sourceId} to delete this trip — it is kept there.`);
        return;
      }
      setBusyFor(trip.id, `deleting on ${remote.label}…`);
      const etag = etagHint ?? (await getSyncRecord(trip.id))?.etag ?? null;
      try {
        await deleteRemoteTrip(remote, trip.id, etag);
      } catch (err) {
        const f = failureOf(err);
        if (f.kind !== 'notfound') {
          setBusyFor(trip.id, null);
          const e = explainFailure(f, remote);
          setNotice(
            f.kind === 'unreachable'
              ? `Connect to ${remote.label} to delete this trip — it is kept there.`
              : `Could not delete on ${remote.label}: ${e.text}`,
          );
          return;
        }
        // Already gone there: deleting the mirror is exactly what remains.
      }
    }
    // The hooks go with the trip: nothing else will ever prune them, and they
    // are the only heavy values in the database.
    await deleteTrip(trip.id);
    await deleteThumbs(trip.posts.map((p) => p.id));
    await deleteSyncRecord(trip.id);
    setBusyFor(trip.id, null);
    refresh();
  }

  async function handleMove(trip: TripDoc, targetSourceId: string) {
    setNotice(null);
    setBusyFor(trip.id, `moving to ${sourceLabel(targetSourceId)}…`);
    const r = await moveTrip(trip, targetSourceId);
    setBusyFor(trip.id, null);
    if (!r.ok) setNotice(r.error);
    refresh();
  }

  /** A trip kept there and not here yet: pull, mirror, then open. */
  async function handleOpenRemote(row: RemoteTripRow) {
    setNotice(null);
    setBusyFor(row.doc.id, `fetching from ${sourceLabel(row.doc.sourceId)}…`);
    await mirrorTrip(row.doc.sourceId, row.doc, row.etag);
    setBusyFor(row.doc.id, null);
    onOpen(row.doc);
  }

  // One group per source: the local ones from `groupBySource`, plus every
  // connected instance with a bucket even when nothing of it is mirrored yet,
  // so its header can say "checking…" or why it could not answer.
  const groups = useMemo(() => {
    if (trips === null) return [];
    const base = groupBySource(trips);
    const seen = new Set(base.map((g) => g.id));
    for (const id of remoteSourceIds) {
      if (!seen.has(id)) base.push({ id, items: [] });
    }
    return base.map((g) => {
      const list = remoteLists[g.id];
      const mirrored = new Set(g.items.map((t) => t.id));
      const remoteOnly =
        list?.status === 'ok' ? list.rows.filter((r) => !mirrored.has(r.doc.id)) : [];
      return { ...g, list, remoteOnly };
    });
  }, [trips, remoteSourceIds, remoteLists]);

  const nothingAnywhere =
    trips !== null && groups.every((g) => g.items.length === 0 && g.remoteOnly.length === 0);

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
                  {sourceLabel(s.id)}
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

      {notice && (
        <p className="m-0 text-[0.8rem] text-[#9a3a23]" role="alert">
          {notice}
        </p>
      )}

      {trips === null ? (
        <p className="m-0 text-[0.85rem] text-muted font-mono">Loading trips…</p>
      ) : nothingAnywhere && remoteSourceIds.every((id) => remoteLists[id]?.status === 'ok') ? (
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
          {groups.map(({ id, items, list, remoteOnly }) => {
            const source = sourceById(id);
            const count = items.length + remoteOnly.length;
            const moveTargets = documentSources.filter((s) => s.id !== id);
            return (
              <section key={id} aria-label={`Trips from ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-[0.66rem] tracking-[0.14em] uppercase text-muted">
                  source: {source?.label ?? id}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">
                    {count} trip{count === 1 ? '' : 's'}
                  </span>
                  {!source && (
                    <span className="text-faint">
                      {' '}
                      · not connected — showing what this device holds
                    </span>
                  )}
                  {list?.status === 'loading' && <span className="text-faint"> · checking…</span>}
                  {list?.status === 'failed' && (
                    <span className="text-faint normal-case tracking-normal">
                      {' '}
                      · {list.text}
                      {list.login && (
                        <>
                          {' '}
                          <a
                            href={list.login}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-ink underline underline-offset-[3px]"
                          >
                            Sign in
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </p>
                {count === 0 ? (
                  <p className="m-0 text-[0.8rem] text-faint">Nothing kept here yet.</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
                    {items.map((trip) => (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        isOpen={trip.id === openTripId}
                        remoteOnly={false}
                        moveTargets={moveTargets}
                        busy={busy[trip.id] ?? null}
                        onOpen={() => onOpen(trip)}
                        onExport={() => handleExport(trip)}
                        onDelete={() => void handleDelete(trip, null)}
                        onMove={(target) => void handleMove(trip, target)}
                      />
                    ))}
                    {remoteOnly.map((row) => (
                      <TripCard
                        key={row.doc.id}
                        trip={row.doc}
                        isOpen={false}
                        remoteOnly
                        moveTargets={[]}
                        busy={busy[row.doc.id] ?? null}
                        onOpen={() => void handleOpenRemote(row)}
                        onExport={() => handleExport(row.doc)}
                        onDelete={() => void handleDelete(row.doc, row.etag)}
                        onMove={() => undefined}
                      />
                    ))}
                  </div>
                )}
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
          timelineSources={timelineSources}
          onSeedFrom={
            onSeedFrom
              ? (id) => {
                  setCreating(false);
                  onSeedFrom(id);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
