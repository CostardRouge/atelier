import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import { requestPersistentStorage } from '../../shared/projects/project-store';
import {
  deleteSyncRecord,
  deleteThumbs,
  deleteTrip,
  getSyncRecord,
  listTrips,
  putSyncRecord,
  putTrip,
} from '../../shared/roadtrip/trip-store';
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
import { pullTrip, pushOnce } from '../../shared/roadtrip/trip-remote';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import { hasTimeline } from '../../shared/sources/winnow/client';
import { TIMELINE_SYNC_ENABLED } from '../../shared/sources/winnow/features';
import {
  getWinnowConnection,
  listWinnowConnections,
  subscribeWinnowConnections,
  type WinnowConnection,
} from '../../shared/sources/winnow/store';
import PostEditor from './PostEditor';
import TimelineImportPanel from './TimelineImportPanel';
import TripGallery from './TripGallery';
import TripOverview from './TripOverview';

/** This tool's own route; every sub-route hangs off it. */
const BASE_ROUTE = ROADTRIP_BASE;
const HOME_ROUTE = ROADTRIP_HOME;

const SAVE_DEBOUNCE_MS = 800;

/** The timeline screen that is open, if one is: which instance, doing what. */
interface Importing {
  connection: WinnowConnection;
  kind: 'seed' | 'complete';
  /** Seed only: the legs a link named. */
  preselect: string[];
}

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
 * Two more routes are LINKS a Winnow can put behind a verb —
 * `/roadtrip/new?source=<host>` and `/roadtrip/<trip>/import?source=<host>`.
 * Both open a screen that proposes and does nothing until confirmed; a host
 * this browser has not connected falls through to `#/connect`, which comes
 * back here once allowed. The link rewrites itself on arrival, so a reload
 * does not re-propose.
 *
 * Edits autosave on a debounce. A refused write is SAID rather than swallowed:
 * the browser can deny IndexedDB (private window, disk pressure) and a trip
 * being told over a year is exactly the thing you must not silently lose.
 *
 * A trip kept on a connected instance saves LOCAL NOW, REMOTE ON IDLE
 * (`docs/roadtrip-persistence.md` D1): the 800 ms IndexedDB write is
 * unchanged, and a second, slower flush pushes the mirror after 5 s of quiet,
 * when the tab hides, when the trip is left, and on "Save now". Opening such
 * a trip opens the mirror at once and asks the instance whether it moved —
 * that is the resume workflow. Every state of that machine is a sentence in
 * the pill, never a silent fallback.
 */
export default function RoadTripTool() {
  const path = useHashRoute();
  const [open, setOpen] = useState<TripDoc | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [importing, setImporting] = useState<Importing | null>(null);
  const [spanNote, setSpanNote] = useState<string | null>(null);
  const route = parseRoadtripPath(path);
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);

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
  // intermittent. A link route is handled by its own effect below.
  const mine = isWithinRoute(path, BASE_ROUTE);
  useEffect(() => {
    if (mine && path !== HOME_ROUTE && !route.ref && !route.link) navigate(HOME_ROUTE);
  }, [mine, path, route.ref, route.link]);

  // A timeline link: resolve its host against what is connected, open the
  // screen, and consume the link. Not connected → the connect screen, told
  // where to come back to. Consumed once per path, so the rewrite it causes
  // cannot re-enter it.
  const consumedLink = useRef<string | null>(null);
  useEffect(() => {
    const link = route.link;
    if (!mine || !link || consumedLink.current === path) return;
    consumedLink.current = path;
    // Asleep: a link is still consumed — the URL must not stay on a proposal
    // nothing will answer — but it opens the ordinary screen, and no instance
    // is asked for a timeline.
    if (!TIMELINE_SYNC_ENABLED) {
      navigate(link.kind === 'seed' || !route.ref ? HOME_ROUTE : roadtripPath(route.ref));
      return;
    }
    const connection = getWinnowConnection(link.source);
    if (!connection) {
      const instance = encodeURIComponent(`https://${link.source}`);
      navigate(`/connect?instance=${instance}&return=${encodeURIComponent(path)}`);
      return;
    }
    setImporting({ connection, kind: link.kind, preselect: link.chapters });
    navigate(link.kind === 'seed' || !route.ref ? HOME_ROUTE : roadtripPath(route.ref));
  }, [mine, path, route.link, route.ref]);

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

  // --- the local save machine ---------------------------------------------

  // One pending write at a time; the latest document wins.
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<TripDoc | null>(null);
  /** The local flush, read by the sync machine through a ref — it is declared after it. */
  const flushRef = useRef<() => Promise<void>>(async () => {});

  // --- the remote machine --------------------------------------------------
  // Shared with every document kind (`use-document-sync.tsx`); this tool only
  // says how a trip is stored and carried, and hands its debounced local write
  // over so a push never carries a trip older than the screen.
  const syncDriver = useMemo<DocumentSyncDriver<TripDoc>>(
    () => ({
      getRecord: getSyncRecord,
      putRecord: putSyncRecord,
      deleteRecord: deleteSyncRecord,
      putDoc: putTrip,
      deleteDoc: async (doc) => {
        await deleteTrip(doc.id);
        // The hooks go with the trip: nothing else will ever prune them.
        await deleteThumbs(doc.posts.map((p) => p.id));
      },
      push: pushOnce,
      pull: (remote, id, etag) => pullTrip(remote, id, etag),
    }),
    [],
  );
  const sync = useDocumentSync<TripDoc>({
    doc: open,
    driver: syncDriver,
    beforeFlush: () => flushRef.current(),
    onDiscardPending: () => {
      pending.current = null;
    },
    onReplace: (doc) => setOpen(doc),
    onDeleted: () => {
      setOpen(null);
      navigate(HOME_ROUTE);
    },
  });
  const { edited, resume, clear } = sync;

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc) return;
    const ok = await putTrip(doc);
    setStorageFailed(!ok);
    // The mirror moved: for a trip kept on an instance the record is dirty
    // from now, and a push is due after the idle delay.
    if (ok) edited(doc);
  }, [edited]);
  flushRef.current = flush;

  useEffect(() => {
    // A trip left mid-edit must not lose its last 800 ms on unmount: the sync
    // machine's own cleanup runs `flush` (then pushes); this only stops the timer.
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

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

  // --- opening a remote trip: the resume workflow -------------------------
  // The mirror opens at once; the instance is asked whether it moved, and a
  // clean mirror is replaced silently when it did (`afterPull`).
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      resumedFor.current = null;
      clear();
      return;
    }
    if (resumedFor.current === open.id) return;
    resumedFor.current = open.id;
    void resume(open).then((r) => {
      if (r?.replaced) setOpen(r.doc);
    });
  }, [open, resume, clear]);

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

  const openImport = useCallback(
    (kind: Importing['kind'], sourceId: string) => {
      const connection = getWinnowConnection(sourceId);
      if (connection) setImporting({ connection, kind, preselect: [] });
    },
    [],
  );

  /** A seeded trip is stored and opened like one made by hand. */
  const handleSeeded = useCallback(
    async (doc: TripDoc) => {
      setImporting(null);
      const ok = await putTrip(doc);
      setStorageFailed(!ok);
      handleOpen(doc);
    },
    [handleOpen],
  );

  const handleApplied = useCallback(
    (doc: TripDoc, spanWidened: boolean) => {
      setImporting(null);
      handleChange(doc);
      setSpanNote(
        spanWidened
          ? `The trip now runs ${doc.startDate} → ${doc.endDate}: its dates grew to hold a leg you accepted.`
          : null,
      );
    },
    [handleChange],
  );

  // By id from the route, never a held copy: editing writes a NEW post into
  // the trip, and a copy would go stale the moment a control moved.
  const editingPost = route.postId
    ? (open?.posts.find((p) => p.id === route.postId) ?? null)
    : null;

  // Asleep: an empty list removes the modal's whole "or seed it from" row,
  // rather than leaving a greyed button for something that cannot light up.
  // With the switch on, every connection is offered again and the greying
  // goes back to meaning "this instance has no timeline".
  const seedSources = TIMELINE_SYNC_ENABLED
    ? connections.map((c) => ({ id: c.id, hasTimeline: hasTimeline(c.capabilities) }))
    : [];
  const completeSources = connections
    .filter((c) => hasTimeline(c.capabilities))
    .map((c) => c.id);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {storageFailed && (
        <p
          className="m-0 px-4 py-2.5 border border-accent bg-accent-wash rounded-paper text-xs text-accent-ink"
          role="alert"
        >
          This trip could not be saved — the browser refused storage (a private
          window, or the disk is full). Your edits are still on screen; copy
          anything you need before closing the tab.
        </p>
      )}
      {spanNote && !showGallery && (
        <p className="m-0 px-4 py-2.5 border border-line bg-surface rounded-paper text-xs text-muted flex items-center gap-3">
          <span className="flex-1">{spanNote}</span>
          <button
            type="button"
            onClick={() => setSpanNote(null)}
            className="p-0 border-0 bg-transparent text-faint cursor-pointer hover:text-ink"
            aria-label="Dismiss"
          >
            ×
          </button>
        </p>
      )}

      {showGallery ? (
        <TripGallery
          openTripId={open?.id ?? null}
          onOpen={handleOpen}
          timelineSources={seedSources}
          onSeedFrom={(id) => openImport('seed', id)}
          onChangeOpenTrip={handleChange}
        />
      ) : editingPost ? (
        <PostEditor
          key={editingPost.id}
          trip={open}
          post={editingPost}
          onBack={() => go(editingPost.date)}
          onChangePost={updatePost}
          onChangeTrip={handleChange}
          headerExtra={sync.pill}
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
          headerExtra={sync.pill}
          timelineSources={completeSources}
          onCompleteFrom={(id) => openImport('complete', id)}
        />
      )}

      {/* A completion needs its trip loaded; a seed needs nothing open. */}
      {importing && (importing.kind === 'seed' || open) && (
        <TimelineImportPanel
          key={`${importing.kind}:${importing.connection.id}`}
          connection={importing.connection}
          mode={
            importing.kind === 'seed'
              ? { kind: 'seed', preselect: importing.preselect }
              : { kind: 'complete', trip: open! }
          }
          onCancel={() => setImporting(null)}
          onSeed={(doc) => void handleSeeded(doc)}
          onApply={handleApplied}
        />
      )}
    </div>
  );
}
