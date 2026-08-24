import { useCallback, useEffect, useState } from 'react';
import { formatIsoDate, spanLength } from '../../shared/roadtrip/trip-days';
import { tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { createTripDoc, type TripDoc } from '../../shared/roadtrip/trip-types';
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

function TripCard({
  trip,
  isOpen,
  onOpen,
  onDelete,
}: {
  trip: TripDoc;
  isOpen: boolean;
  onOpen: () => void;
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

  const refresh = useCallback(() => {
    void listTrips().then(setTrips);
  }, []);

  useEffect(refresh, [refresh]);

  async function handleCreate(choices: NewTripChoices) {
    const doc = createTripDoc(
      choices.name,
      choices.destination,
      choices.startDate,
      choices.endDate,
    );
    await putTrip(doc);
    setCreating(false);
    onOpen(doc);
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
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent active:scale-[0.98]"
        >
          + New trip
        </button>
      </div>

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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5 pb-4">
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              isOpen={trip.id === openTripId}
              onOpen={() => onOpen(trip)}
              onDelete={() => void handleDelete(trip.id)}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewTripModal
          onCancel={() => setCreating(false)}
          onCreate={(choices) => void handleCreate(choices)}
        />
      )}
    </section>
  );
}
