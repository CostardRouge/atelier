import { useCallback, useEffect, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import { requestPersistentStorage } from '../../shared/projects/project-store';
import { listTrips, putTrip } from '../../shared/roadtrip/trip-store';
import {
  ROADTRIP_BASE,
  ROADTRIP_HOME,
  parseRoadtripPath,
  roadtripPath,
  tripFromRef,
  tripRef,
} from '../../shared/roadtrip/trip-route';
import type { IsoDate } from '../../shared/roadtrip/trip-days';
import type { TripDoc, TripPost } from '../../shared/roadtrip/trip-types';
import PostEditor from './PostEditor';
import TripGallery from './TripGallery';
import TripOverview from './TripOverview';

/** This tool's own route; every sub-route hangs off it. */
const BASE_ROUTE = ROADTRIP_BASE;
const HOME_ROUTE = ROADTRIP_HOME;

const SAVE_DEBOUNCE_MS = 800;

/**
 * Road Trip shell — trips-first, the same shape as the studio's:
 * `/roadtrip/home` lists them, and everything else is addressed:
 * `/roadtrip/<trip>/<day>/<piece>`, any tail of which may be absent.
 *
 * WHERE YOU ARE LIVES IN THE ROUTE, not in component state. It used to be
 * state, and coming back from a piece dropped you on the trip's first day
 * rather than the day you were working on — a real loss on a 300-day trip,
 * every single time. The route also survives a reload and makes a day
 * linkable. Only the shell knows about documents and persistence; the
 * overview edits a trip and hands it back.
 *
 * Edits autosave on a debounce. A refused write is SAID rather than swallowed:
 * the browser can deny IndexedDB (private window, disk pressure) and a trip
 * being told over a year is exactly the thing you must not silently lose.
 */
export default function RoadTripTool() {
  const path = useHashRoute();
  const [open, setOpen] = useState<TripDoc | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const route = parseRoadtripPath(path);

  // Ask the browser (once) not to evict our stores under disk pressure.
  const persistAsked = useRef(false);
  useEffect(() => {
    if (persistAsked.current) return;
    persistAsked.current = true;
    void requestPersistentStorage();
  }, []);

  const showGallery = !route.ref || !open;
  // Guarded by `isWithinRoute`: this tool is still mounted and still
  // subscribed to the route at the instant the hash changes to another
  // tool's, and without the guard it would read that path, find it
  // incomplete, and navigate straight back here — the switcher doing nothing
  // at all. It only bit with no document open, which is what made it look
  // intermittent.
  const mine = isWithinRoute(path, BASE_ROUTE);
  useEffect(() => {
    if (mine && path !== HOME_ROUTE && !route.ref) navigate(HOME_ROUTE);
  }, [mine, path, route.ref]);

  /**
   * Load whatever trip the route names. Keyed on the reference, so a link
   * pasted into a fresh tab opens the right trip and switching trips reloads
   * — but editing the open one does not, since the ref does not change.
   */
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mine || !route.ref) return;
    if (loadedRef.current === route.ref && open) return;
    loadedRef.current = route.ref;
    void listTrips().then((trips) => {
      const found = tripFromRef(route.ref!, trips);
      if (found) setOpen(found);
      else navigate(HOME_ROUTE); // a link to a trip this browser no longer has
    });
  }, [mine, route.ref, open]);


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
    loadedRef.current = tripRef(doc);
    navigate(roadtripPath(tripRef(doc)));
  }, []);

  /** Move within the open trip without losing where you were. */
  const go = useCallback(
    (date: IsoDate | null, postId: string | null = null) => {
      if (!open) return;
      navigate(roadtripPath(tripRef(open), date, postId));
    },
    [open],
  );

  const updatePost = useCallback(
    (post: TripPost) => {
      if (!open) return;
      handleChange({
        ...open,
        posts: open.posts.map((p) => (p.id === post.id ? post : p)),
        updatedAt: Date.now(),
      });
    },
    [open, handleChange],
  );

  // By id from the route, never a held copy: editing writes a NEW post into
  // the trip, and a copy would go stale the moment a control moved.
  const editingPost = route.postId
    ? (open?.posts.find((p) => p.id === route.postId) ?? null)
    : null;

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
      ) : editingPost ? (
        <PostEditor
          key={editingPost.id}
          trip={open}
          post={editingPost}
          onBack={() => go(editingPost.date)}
          onChangePost={updatePost}
          onChangeTrip={handleChange}
        />
      ) : (
        <TripOverview
          key={open.id}
          trip={open}
          selectedDate={route.date}
          onSelectDate={(date) => go(date)}
          onShowTrips={() => navigate(HOME_ROUTE)}
          onChange={handleChange}
          onOpenPost={(post) => go(post.date, post.id)}
        />
      )}
    </div>
  );
}
