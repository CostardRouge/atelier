import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  REMOTE_IDLE_MS,
  newSyncRecord,
  reduceSync,
  shouldFlush,
  type SyncRecord,
} from '../../shared/roadtrip/trip-sync';
import {
  isRemoteSource,
  outcomeEvent,
  pullTrip,
  pushOnce,
  remoteFor,
} from '../../shared/roadtrip/trip-remote';
import { DEFAULT_SOURCE_ID } from '../../shared/sources/source';
import PostEditor from './PostEditor';
import SyncPill from './SyncPill';
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
  const [sync, setSync] = useState<SyncRecord | null>(null);
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

  // The open document and its sync record, readable from callbacks that
  // outlive a render (timers, unmount, a push that was out when it changed).
  const openRef = useRef<TripDoc | null>(null);
  openRef.current = open;
  const syncRef = useRef<SyncRecord | null>(null);

  /** The one writer of the record: memory, state and store together. */
  const setRecord = useCallback((rec: SyncRecord | null) => {
    syncRef.current = rec;
    setSync(rec);
    if (rec) void putSyncRecord(rec);
  }, []);

  const openSourceId = open?.sourceId ?? null;
  const remote = useMemo(
    () => (openSourceId ? remoteFor(openSourceId) : null),
    [openSourceId],
  );

  // --- the remote flush ------------------------------------------------

  const remoteTimer = useRef<number | null>(null);
  const pushing = useRef(false);

  /**
   * Push the mirror if the record says it is due. `force` skips the idle
   * wait (tab hidden, leaving, "Save now") but never the held states — a
   * conflict is a person's decision, not a timer's.
   */
  const remoteFlush = useCallback(
    async (force = false) => {
      const doc = openRef.current;
      const rec = syncRef.current;
      if (!doc || !rec || !remote || remote.sourceId !== doc.sourceId) return;
      if (pushing.current) return;
      if (!shouldFlush(rec, Date.now(), force ? 0 : REMOTE_IDLE_MS)) return;
      pushing.current = true;
      try {
        setRecord(reduceSync(rec, { type: 'pushStarted', now: Date.now() }));
        const outcome = await pushOnce(remote, doc, rec.etag);
        // The record may have moved on while the request was out (an edit,
        // another trip opened): reduce the LIVE one, and only if it is still
        // this trip's.
        const live = syncRef.current;
        if (live && live.id === doc.id) {
          setRecord(reduceSync(live, outcomeEvent(outcome, Date.now())));
        }
      } finally {
        pushing.current = false;
      }
    },
    [remote, setRecord],
  );

  const armRemote = useCallback(() => {
    if (remoteTimer.current !== null) window.clearTimeout(remoteTimer.current);
    remoteTimer.current = window.setTimeout(() => {
      remoteTimer.current = null;
      void remoteFlush(false);
    }, REMOTE_IDLE_MS + 50);
  }, [remoteFlush]);

  // --- the local save machine ---------------------------------------------

  // One pending write at a time; the latest document wins.
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<TripDoc | null>(null);

  const flush = useCallback(async () => {
    const doc = pending.current;
    pending.current = null;
    if (!doc) return;
    const ok = await putTrip(doc);
    setStorageFailed(!ok);
    // The mirror moved: the record is dirty from now, and a push is due
    // after the idle delay. A local trip has no record and none is made.
    if (ok && isRemoteSource(doc.sourceId)) {
      const now = Date.now();
      const rec = syncRef.current?.id === doc.id ? syncRef.current : null;
      setRecord(reduceSync(rec ?? newSyncRecord(doc.id, doc.sourceId, now), { type: 'edited', now }));
      armRemote();
    }
  }, [setRecord, armRemote]);

  useEffect(() => {
    // A trip left mid-edit must not lose its last 800 ms on unmount — nor
    // its push: best effort, and the dirty record covers what does not land.
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      if (remoteTimer.current !== null) window.clearTimeout(remoteTimer.current);
      void flush().then(() => remoteFlush(true));
    };
  }, [flush, remoteFlush]);

  // A hidden tab is often a tab about to be closed: push what is dirty now.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flush().then(() => remoteFlush(true));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flush, remoteFlush]);

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

  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      resumedFor.current = null;
      syncRef.current = null;
      setSync(null);
      return;
    }
    if (resumedFor.current === open.id) return;
    resumedFor.current = open.id;
    if (!isRemoteSource(open.sourceId)) {
      syncRef.current = null;
      setSync(null);
      return;
    }
    const id = open.id;
    const sourceId = open.sourceId;
    void (async () => {
      const stored = await getSyncRecord(id);
      if (openRef.current?.id !== id) return;
      // A mirror with no record (a push that never got to write one) is
      // simply dirty: it goes up on the next trigger.
      const rec = stored ?? newSyncRecord(id, sourceId, Date.now());
      setRecord(rec);
      const r = remoteFor(sourceId);
      if (!r) return; // not connected, or no bucket: the pill's text says so through the gallery
      const pulled = await pullTrip(r, id, rec.etag);
      const live = syncRef.current;
      if (openRef.current?.id !== id || !live || live.id !== id) return;
      if (pulled.kind === 'current') return;
      if (pulled.kind === 'fetched') {
        if (live.dirtyAt === null) {
          // Clean mirror: the server's copy is simply newer. Replace silently.
          await putTrip(pulled.doc);
          setOpen(pulled.doc);
          setRecord(reduceSync(live, { type: 'pulled', etag: pulled.etag, now: Date.now() }));
        } else {
          // Both moved. Nothing is overwritten; the pill offers the two ways out.
          setRecord(
            reduceSync(live, {
              type: 'pushFailed',
              kind: 'conflict',
              message: 'changed on another device',
              theirs: { etag: pulled.etag, updatedAt: pulled.updatedAt },
            }),
          );
        }
        return;
      }
      // Unreachable, signed out, gone: say it. A protocol error on a clean
      // mirror is not worth a sentence — the next push will report it.
      if (pulled.failure.kind === 'protocol' && live.dirtyAt === null) return;
      setRecord(
        reduceSync(live, {
          type: 'pushFailed',
          kind: pulled.failure.kind,
          message: pulled.failure.message,
          theirs: pulled.failure.theirs ?? undefined,
        }),
      );
    })();
  }, [open, setRecord]);

  // --- the pill's verbs ---------------------------------------------------

  const keepMine = useCallback(() => {
    const rec = syncRef.current;
    if (!rec) return;
    setRecord(reduceSync(rec, { type: 'resolvedKeepMine' }));
    void remoteFlush(true);
  }, [setRecord, remoteFlush]);

  const takeTheirs = useCallback(async () => {
    const doc = openRef.current;
    const rec = syncRef.current;
    if (!doc || !rec || !remote) return;
    const pulled = await pullTrip(remote, doc.id, null);
    const live = syncRef.current;
    if (openRef.current?.id !== doc.id || !live) return;
    if (pulled.kind === 'fetched') {
      pending.current = null; // whatever was about to be saved is the edit being dropped
      await putTrip(pulled.doc);
      setOpen(pulled.doc);
      setRecord(reduceSync(live, { type: 'resolvedTakeTheirs', etag: pulled.etag, now: Date.now() }));
    } else if (pulled.kind === 'failed') {
      setRecord(
        reduceSync(live, {
          type: 'pushFailed',
          kind: pulled.failure.kind,
          message: pulled.failure.message,
          theirs: pulled.failure.theirs ?? undefined,
        }),
      );
    }
  }, [remote, setRecord]);

  const keepLocal = useCallback(async () => {
    const doc = openRef.current;
    if (!doc) return;
    const local = { ...doc, sourceId: DEFAULT_SOURCE_ID, updatedAt: Date.now() };
    pending.current = null;
    await putTrip(local);
    await deleteSyncRecord(doc.id);
    syncRef.current = null;
    setSync(null);
    setOpen(local);
  }, []);

  const deleteHere = useCallback(async () => {
    const doc = openRef.current;
    if (!doc) return;
    pending.current = null;
    await deleteTrip(doc.id);
    await deleteThumbs(doc.posts.map((p) => p.id));
    await deleteSyncRecord(doc.id);
    syncRef.current = null;
    setSync(null);
    setOpen(null);
    navigate(HOME_ROUTE);
  }, []);

  const pill =
    open && sync && isRemoteSource(open.sourceId) ? (
      <SyncPill
        record={sync}
        sourceLabel={remote?.label ?? open.sourceId}
        loginUrl={remote?.client.loginUrl() ?? null}
        onSaveNow={() => void flush().then(() => remoteFlush(true))}
        onKeepMine={keepMine}
        onTakeTheirs={() => void takeTheirs()}
        onKeepLocal={() => void keepLocal()}
        onDeleteHere={() => void deleteHere()}
      />
    ) : null;

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
          headerExtra={pill}
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
          headerExtra={pill}
        />
      )}
    </div>
  );
}
