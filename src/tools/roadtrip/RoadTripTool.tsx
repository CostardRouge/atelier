import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate, useHashRoute } from '../../app/use-hash-route';
import { requestPersistentStorage } from '../../shared/projects/project-store';
import { putTrip } from '../../shared/roadtrip/trip-store';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import TripGallery from './TripGallery';
import TripOverview from './TripOverview';

/** The gallery sub-route; `/roadtrip` itself is the open trip. */
const HOME_ROUTE = '/roadtrip/home';

const SAVE_DEBOUNCE_MS = 800;

/**
 * Road Trip shell — trips-first, the same shape as the studio's: `/roadtrip/home`
 * lists them, opening one lands on `/roadtrip`. Only the shell knows about
 * documents and persistence; the overview edits a trip and hands it back.
 *
 * Edits autosave on a debounce. A refused write is SAID rather than swallowed:
 * the browser can deny IndexedDB (private window, disk pressure) and a trip
 * being told over a year is exactly the thing you must not silently lose.
 */
export default function RoadTripTool() {
  const path = useHashRoute();
  const [open, setOpen] = useState<TripDoc | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);

  // Ask the browser (once) not to evict our stores under disk pressure.
  const persistAsked = useRef(false);
  useEffect(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    void requestPersistentStorage();
  }, []);

  const showGallery = path === HOME_ROUTE || !open;
  useEffect(() => {
    if (path !== HOME_ROUTE && !open) navigate(HOME_ROUTE);
  }, [path, open]);

  // One pending write at a time; the latest document wins.
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<TripDoc | null>(null);

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc) return;
    const ok = await putTrip(doc);
    setStorageFailed(!ok);
  }, []);

  useEffect(() => {
    // A trip left mid-edit must not lose its last 800 ms on unmount.
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      void flush();
    };
  }, [flush]);

  const handleChange = useCallback(
    (doc: TripDoc) => {
      setOpen(doc);
      pending.current = doc;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void flush();
      }, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const handleOpen = useCallback((doc: TripDoc) => {
    setOpen(doc);
    navigate('/roadtrip');
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {storageFailed && (
        <p
          className="m-0 px-4 py-2.5 border border-accent bg-accent-wash rounded-paper text-[0.8rem] text-accent-ink"
          role="alert"
        >
          This trip could not be saved — the browser refused storage (a private
          window, or the disk is full). Your edits are still on screen; copy
          anything you need before closing the tab.
        </p>
      )}

      {showGallery ? (
        <TripGallery openTripId={open?.id ?? null} onOpen={handleOpen} />
      ) : (
        <TripOverview
          key={open.id}
          trip={open}
          onShowTrips={() => navigate(HOME_ROUTE)}
          onChange={handleChange}
        />
      )}
    </div>
  );
}
