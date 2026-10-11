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
import { createTripDoc, createTripPost, type PostKind, type TripDoc, type TripPost } from '../../shared/roadtrip/trip-types';
import { CommandError, commands, waitForCommand } from '../../shared/commands/registry';
import { dayFacts } from '../../shared/roadtrip/day-facts';
import { tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { WinnowClient, hasTimeline } from '../../shared/sources/winnow/client';
import { libraryStats } from '../../shared/sources/winnow/stats';
import { fileBaseName } from '../../shared/library/assets';
import { useRegisterCommands } from '../../shared/commands/use-commands';
import { readDay } from '../../shared/develop/ingest-commands';
import { tripDetail, tripSummary } from '../../shared/roadtrip/trip-commands';
import { applyHouseStyle } from '../../shared/roadtrip/house-style';
import { bundledHouseStyle } from '../../shared/roadtrip/house-style-bundle';
import { pullTrip, pushOnce } from '../../shared/roadtrip/trip-remote';
import useHistory, { type DocumentHistory } from '../../shared/history/use-history';
import { useDocumentSync, type DocumentSyncDriver } from '../../shared/sources/use-document-sync';
import { TIMELINE_SYNC_ENABLED } from '../../shared/sources/winnow/features';
import {
  getWinnowConnection,
  listWinnowConnections,
  subscribeWinnowConnections,
  type WinnowConnection,
} from '../../shared/sources/winnow/store';
import PostEditor from './PostEditor';
import TimelineImportPanel from './TimelineImportPanel';
import DeduceStagesPanel from './deduce/DeduceStagesPanel';
import TripGallery from './TripGallery';
import type { TripSettingsSection } from './TripSettingsModal';
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
  const [deducing, setDeducing] = useState<WinnowConnection | null>(null);
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
    const ref = route.ref;
    let alive = true;
    void listTrips().then((trips) => {
      // Two links opened back to back resolve in any order: only the one
      // the route still names may open, or the earlier answer landed last,
      // opened the wrong trip, and the guard above then kept the right one
      // from ever loading.
      if (!alive || loadedRef.current !== ref) return;
      const found = tripFromRef(ref, trips);
      if (found) setOpen(found);
      else navigate(HOME_ROUTE); // a link to a trip this browser no longer has
    });
    return () => {
      alive = false;
    };
  }, [mine, route.ref, open]);

  // --- the local save machine ---------------------------------------------

  // One pending write at a time; the latest document wins.
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<TripDoc | null>(null);
  /** The local flush, read by the sync machine through a ref — it is declared after it. */
  const flushRef = useRef<() => Promise<void>>(async () => {});
  /** The undo stack, read by the sync machine the same way. */
  const historyRef = useRef<DocumentHistory<TripDoc | null> | null>(null);

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
    onReplace: (doc) => replaceOpen(doc),
    onDeleted: () => {
      setOpen(null);
      navigate(HOME_ROUTE);
    },
  });
  const { edited, resume, clear } = sync;

  /**
   * The document replaced UNDER the tool — by the pill's verbs, or by a
   * resume that found the instance's copy newer than a clean mirror. Not an
   * edit: undoing back onto what it replaced would push the losing version
   * straight back up, so the history starts again from it, and a write the
   * debounce still holds is dropped rather than landing over it.
   */
  function replaceOpen(doc: TripDoc) {
    pending.current = null;
    setOpen(doc);
    historyRef.current?.reset(doc);
  }

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

  // --- undo and redo -------------------------------------------------------
  // The shared engine (`shared/history/`) WATCHES the funnel above: every trip
  // handed back through it is a step, wherever it came from — a badge dragged,
  // a leg resized, a piece deleted, the cover picked from the gallery. Nothing
  // below had to learn about it. The label is the screen you are on, so a
  // gesture on one piece never merges with the trip-wide change made right
  // after it; a restore goes back out through `handleChange`, which saves and
  // marks the trip dirty exactly as an edit does.
  const history = useHistory<TripDoc | null>({
    value: open,
    subject: open?.id ?? null,
    label: route.postId ? `post:${route.postId}` : 'trip',
    what: 'edit',
    onRestore: (doc) => {
      if (doc) handleChange(doc);
    },
  });
  historyRef.current = history;

  // --- the tool's commands (`shared/commands/`, `trip-commands.ts`) ---------
  // Trips and pieces as an agent drives them: every write goes through
  // `handleChange`, so it is saved, synced and one step of the undo stack
  // above, exactly like a gesture. The open PIECE registers its own
  // (`PostEditor`).
  async function findTrip(id: unknown): Promise<TripDoc> {
    const found = (await listTrips()).find((t) => t.id === id);
    if (!found) throw new CommandError('invalid', `no trip "${String(id)}" — trips.list lists them`);
    return open && open.id === found.id ? open : found;
  }
  const needOpen = () => (open ? true : 'no trip is open — trips.open opens one');
  const winnowClient = (conn: WinnowConnection) => new WinnowClient({ baseUrl: conn.baseUrl, auth: conn.auth });
  /** Until the piece editor of THIS piece has registered its commands — a previous piece's would answer otherwise. */
  const untilPieceOpen = async (pieceId: string) => {
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      await waitForCommand(commands, 'trips.piece', until - Date.now());
      const piece = (await commands.execute('trips.piece')) as { id: string };
      if (piece.id === pieceId) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new CommandError('failed', 'the piece did not open in time');
  };
  useRegisterCommands('trips', [
    {
      id: 'trips.list',
      title: 'List the trips',
      description: 'Every trip this browser holds — id, name, first and last day, how many legs and pieces — and which one is open.',
      run: async () => ({
        open: open?.id ?? null,
        trips: (await listTrips()).map((t) => tripSummary(open && t.id === open.id ? open : t)),
      }),
    },
    {
      id: 'trips.create',
      title: 'Make a trip',
      description: 'Make a trip kept in this browser over two days (YYYY-MM-DD) and open it. It wears the house style when one is committed. Its legs can then be deduced from Winnow in the app, and pieces made with trips.newPiece.',
      params: {
        name: { type: 'string', description: 'The trip’s name, as its badge says it.' },
        from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD.' },
      },
      run: async (p) => {
        const name = (p.name as string).trim();
        if (!name) throw new CommandError('invalid', 'a trip needs a name');
        const from = readDay('from', p.from);
        const to = readDay('to', p.to);
        if (to < from) throw new CommandError('invalid', 'to comes before from');
        const doc = applyHouseStyle(createTripDoc(name, from, to), bundledHouseStyle());
        if (!(await putTrip(doc))) throw new CommandError('failed', 'the browser refused to store the trip');
        handleOpen(doc);
        return tripSummary(doc);
      },
    },
    {
      id: 'trips.open',
      title: 'Open a trip, a day or a piece',
      description: 'Open a trip on its overview, on one of its days, or on one of its pieces. A piece’s own commands (trips.piece…) open once its editor has — wait for trips.piece with app.waitFor.',
      params: {
        trip: { type: 'string', description: 'The trip id, from trips.list.' },
        date: { type: 'string', description: 'A day of the trip, YYYY-MM-DD.', optional: true },
        piece: { type: 'string', description: 'A piece id, from trips.get.', optional: true },
      },
      run: async (p) => {
        const trip = await findTrip(p.trip);
        const post = typeof p.piece === 'string' ? trip.posts.find((x) => x.id === p.piece) : undefined;
        if (typeof p.piece === 'string' && !post) throw new CommandError('invalid', `the trip holds no piece "${p.piece}"`);
        const date = post?.date ?? (p.date === undefined ? null : readDay('date', p.date));
        if (date && (date < trip.startDate || date > trip.endDate)) {
          throw new CommandError('invalid', `${date} is outside the trip (${trip.startDate} → ${trip.endDate})`);
        }
        if (!open || open.id !== trip.id) handleOpen(trip);
        navigate(roadtripPath(tripRef(trip), date, post?.id ?? null));
        return { trip: trip.id, date, piece: post?.id ?? null };
      },
    },
    {
      id: 'trips.get',
      title: 'Read the open trip',
      description: 'The open trip: its days, its legs with their places, and its pieces (id, kind, day, title, how many pictures, opener, published).',
      available: needOpen,
      run: () => (open ? tripDetail(open) : null),
    },
    {
      id: 'trips.rename',
      title: 'Rename the open trip',
      description: 'Give the open trip a new name — the name its badges say. One undo step.',
      params: { name: { type: 'string', description: 'The new name.' } },
      available: needOpen,
      run: (p) => {
        const name = (p.name as string).trim();
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        if (!name) throw new CommandError('invalid', 'a trip needs a name');
        handleChange({ ...open, name, updatedAt: Date.now() });
        return { trip: open.id, name };
      },
    },
    {
      id: 'trips.newPiece',
      title: 'Start a piece on a day',
      description:
        'Start a piece telling a day of the open trip — reel (one video, the badge burned into its opening), carousel (several slides) or photo — wearing the look the trip last gave that kind, and open it. Then trips.setPictures fills it, trips.setOpener and trips.badge dress it, trips.snapshot shows it, trips.export delivers it.',
      params: {
        date: { type: 'string', description: 'The day it tells, YYYY-MM-DD.' },
        kind: { type: 'string', description: 'reel, carousel or photo.', enum: ['reel', 'carousel', 'photo'] },
        title: { type: 'string', description: 'A working title, to find it again (never published).', optional: true },
      },
      available: needOpen,
      run: (p) => {
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        const date = readDay('date', p.date);
        if (date < open.startDate || date > open.endDate) {
          throw new CommandError('invalid', `${date} is outside the trip (${open.startDate} → ${open.endDate})`);
        }
        const kind = p.kind as PostKind;
        const post = createTripPost(kind, date, typeof p.title === 'string' ? p.title : '', null, open.hookDefaults[kind]);
        handleChange({ ...open, posts: [...open.posts, post], updatedAt: Date.now() });
        navigate(roadtripPath(tripRef(open), date, post.id));
        return { piece: post.id, kind, date };
      },
    },
    {
      id: 'trips.deletePiece',
      title: 'Delete a piece',
      description: 'Take a piece off the open trip. One undo step (trips.undo brings it back).',
      params: { piece: { type: 'string', description: 'The piece id, from trips.get.' } },
      available: needOpen,
      run: (p) => {
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        const post = open.posts.find((x) => x.id === p.piece);
        if (!post) throw new CommandError('invalid', `the trip holds no piece "${String(p.piece)}"`);
        if (route.postId === post.id) navigate(roadtripPath(tripRef(open), post.date));
        void deleteThumbs([post.id]);
        handleChange({ ...open, posts: open.posts.filter((x) => x.id !== post.id), updatedAt: Date.now() });
        return { deleted: post.id };
      },
    },
    {
      id: 'trips.facts',
      title: 'The facts of a day',
      description:
        'What the open trip knows of a day, for a caption written from FACTS: its number over the trip, its leg and places, the place it is told from, the vehicle, the kilometres its road holds, sunrise and sunset over the place (on the zone Winnow knows for that day’s frames, else the longitude’s — said which), the pieces telling it; and, with a Winnow connected, how many frames that day, photos and clips, by gear and light, how many picks and faces. Nothing invented: what the document and the instance do not say is null.',
      params: { date: { type: 'string', description: 'The day, YYYY-MM-DD.' } },
      available: needOpen,
      run: async (p) => {
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        const date = readDay('date', p.date);
        const conn = connections[0];
        let winnow: Record<string, unknown> | null = null;
        let offset: number | null = null;
        if (conn) {
          try {
            const rows = await winnowClient(conn).allAssets({ dateFrom: date, dateTo: date }, 2000);
            offset = rows.find((r) => typeof r.capture_offset_min === 'number')?.capture_offset_min ?? null;
            const s = libraryStats(rows, () => null);
            winnow = { instance: conn.id, frames: s.media.total, photos: s.media.photo, clips: s.media.video, byGear: s.byGear, byLight: s.byLight, picks: s.byVerdict.pick ?? 0, faces: rows.reduce((n, r) => n + (r.face_count ?? 0), 0) };
          } catch (err) {
            winnow = { instance: conn.id, error: err instanceof Error ? err.message : String(err) };
          }
        }
        return { ...dayFacts(open, date, offset), winnow };
      },
    },
    {
      id: 'trips.gaps',
      title: 'The days nobody tells',
      description:
        'The open trip’s coverage: how many days are told by a piece, the runs of days with none (the gaps, the longest first), and — with a Winnow connected — which untold days hold media and how many, so the next piece goes where the pictures are. Days with no media at all are listed apart.',
      available: needOpen,
      run: async () => {
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        const c = tripCoverage(open);
        const conn = connections[0];
        let media: { date: string; count: number }[] | null = null;
        if (conn) {
          try {
            media = (await winnowClient(conn).calendar(open.startDate, open.endDate)).days.map((d) => ({ date: d.date, count: d.count }));
          } catch {
            media = null;
          }
        }
        const told = new Set(c.days.filter((d) => d.posts.length > 0).map((d) => d.date));
        const counts = media ? new Map(media.map((d) => [d.date, d.count])) : null;
        return {
          totalDays: c.totalDays,
          toldDays: c.toldDays,
          publishedDays: c.publishedDays,
          gaps: [...c.gaps].sort((a, b) => b.length - a.length),
          ...(counts
            ? {
                untoldWithMedia: c.days.filter((d) => !told.has(d.date) && (counts.get(d.date) ?? 0) > 0).map((d) => ({ date: d.date, count: counts.get(d.date)! })).sort((a, b) => b.count - a.count),
                withoutMedia: c.days.filter((d) => !(counts.get(d.date) ?? 0)).map((d) => d.date),
              }
            : {}),
        };
      },
    },
    {
      id: 'trips.publishing',
      title: 'What is published, what waits',
      description: 'The open trip’s pieces by state — published (with the day they went out) and drafts, oldest first — the coverage in one line, and the day to tell next: the untold day holding the most media when a Winnow answers, else the first day of the longest gap.',
      available: needOpen,
      run: async () => {
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        const gaps = (await commands.execute('trips.gaps')) as { untoldWithMedia?: { date: string; count: number }[]; gaps: { start: string; length: number }[]; toldDays: number; totalDays: number };
        const line = (post: TripPost) => ({ id: post.id, kind: post.kind, date: post.date, ...(post.endDate ? { endDate: post.endDate } : {}), title: post.title || null, pictures: (post.media ? 1 : 0) + post.slides.filter((s) => s.media).length });
        const sorted = [...open.posts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const next = gaps.untoldWithMedia?.[0] ?? (gaps.gaps[0] ? { date: gaps.gaps[0].start, count: null } : null);
        return {
          published: sorted.filter((x) => x.publishedAt).map((x) => ({ ...line(x), publishedAt: new Date(x.publishedAt!).toISOString().slice(0, 10) })),
          drafts: sorted.filter((x) => !x.publishedAt).map(line),
          coverage: `${gaps.toldDays} of ${gaps.totalDays} days told`,
          next,
        };
      },
    },
    {
      id: 'trips.storyPiece',
      title: 'A piece told by the frames that tell the span',
      description:
        'One call from a span to a piece: curate.story picks the frames of the open trip’s day (or span) from the connected Winnow — narrowed by verdict, stars, people, who —, they are fetched into the Library, a piece is started on the day (carousel unless kind says) and its pictures set in the story’s order. Then trips.setOpener / trips.badge dress it, trips.snapshot shows it, trips.export delivers it. Answers the piece, each pick with its reason.',
      params: {
        date: { type: 'string', description: 'The day, YYYY-MM-DD (the first of a span with dateTo).' },
        dateTo: { type: 'string', description: 'The span’s last day; the same day when absent.', optional: true },
        count: { type: 'number', description: 'How many frames; 8 when absent.', integer: true, min: 1, max: 20, optional: true },
        kind: { type: 'string', description: 'carousel (the default), reel or photo.', enum: ['carousel', 'reel', 'photo'], optional: true },
        prefer: { type: 'string', description: 'The frame shape to favour: portrait, landscape or square.', enum: ['portrait', 'landscape', 'square'], optional: true },
        title: { type: 'string', description: 'A working title; "Story of <day>" when absent.', optional: true },
        verdict: { type: 'string', description: 'Only this Winnow verdict.', enum: ['pick', 'reject', 'skip', 'unrated'], optional: true },
        minStars: { type: 'number', description: 'At least this many stars.', min: 0, max: 5, integer: true, optional: true },
        people: { type: 'numbers', description: 'Only frames showing these people (ids from winnow.people).', integer: true, min: 1, maxItems: 20, optional: true },
        who: { type: 'strings', description: 'The same by name.', optional: true },
      },
      available: () => (!open ? 'no trip is open — trips.open opens one' : connections.length ? true : 'no Winnow is connected — connect one on #/sources'),
      run: async (p) => {
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        const date = readDay('date', p.date);
        const dateTo = p.dateTo === undefined ? null : readDay('dateTo', p.dateTo);
        if (dateTo && dateTo < date) throw new CommandError('invalid', 'dateTo comes before date');
        if (date < open.startDate || (dateTo ?? date) > open.endDate) throw new CommandError('invalid', `${date} is outside the trip (${open.startDate} → ${open.endDate})`);
        const kind = (p.kind as PostKind | undefined) ?? 'carousel';
        const count = typeof p.count === 'number' ? p.count : kind === 'photo' ? 1 : 8;
        const story = (await commands.execute('curate.story', {
          date,
          ...(dateTo ? { dateTo } : {}),
          count,
          media: 'photo',
          ...(p.prefer ? { prefer: p.prefer } : {}),
          ...(p.verdict ? { verdict: p.verdict } : {}),
          ...(p.minStars !== undefined ? { minStars: p.minStars } : {}),
          ...(p.people ? { people: p.people } : {}),
          ...(p.who ? { who: p.who } : {}),
        })) as { ids: number[]; picks: { id: number; file: string; reason: string }[] };
        if (!story.ids.length) throw new CommandError('invalid', 'nothing to tell — no frame of that span was kept');
        const fetched = (await commands.execute('library.addFromWinnow', { ids: story.ids })) as { added: string[]; alreadyInLibrary: string[]; notFound?: number[] };
        const post = createTripPost(kind, date, typeof p.title === 'string' ? p.title : `Story of ${date}`, dateTo && dateTo !== date ? dateTo : null, open.hookDefaults[kind]);
        handleChange({ ...open, posts: [...open.posts, post], updatedAt: Date.now() });
        navigate(roadtripPath(tripRef(open), date, post.id));
        await untilPieceOpen(post.id);
        const assets = story.picks.map((pick) => fileBaseName(pick.file).toLowerCase());
        const set = await commands.execute('trips.setPictures', { assets });
        return { piece: post.id, kind, date, ...(dateTo ? { dateTo } : {}), picks: story.picks.map((x) => ({ id: x.id, file: x.file, reason: x.reason })), fetched, ...(set as object) };
      },
    },
    {
      id: 'trips.recap',
      title: 'A recap of a leg',
      description: 'Start a reel telling a whole LEG of the open trip, dated over the leg’s days and opening with Virée — the vehicle driving the leg’s places on the map — and open it. Then trips.setPictures gives it pictures to pop at the stops, trips.badge its words. Answers the piece.',
      params: {
        stage: { type: 'string', description: 'The leg’s id or name, from trips.get.' },
        title: { type: 'string', description: 'A working title; the leg’s name when absent.', optional: true },
      },
      available: needOpen,
      run: async (p) => {
        if (!open) throw new CommandError('unavailable', 'no trip is open');
        const key = String(p.stage).trim().toLowerCase();
        const stage = open.stages.find((s) => s.id === p.stage) ?? open.stages.find((s) => s.name.trim().toLowerCase() === key);
        if (!stage) throw new CommandError('invalid', `no leg "${String(p.stage)}" — the legs are ${open.stages.map((s) => `${s.name || '(unnamed)'} (#${s.id})`).join(', ') || 'none'}`);
        const post = createTripPost('reel', stage.startDate, typeof p.title === 'string' ? p.title : stage.name || `Leg ${stage.startDate}`, stage.endDate !== stage.startDate ? stage.endDate : null, open.hookDefaults.reel);
        handleChange({ ...open, posts: [...open.posts, post], updatedAt: Date.now() });
        navigate(roadtripPath(tripRef(open), stage.startDate, post.id));
        await untilPieceOpen(post.id);
        const opener = await commands.execute('trips.setOpener', { opener: 'drive' });
        return { piece: post.id, stage: stage.id, from: stage.startDate, to: stage.endDate, places: stage.places.map((x) => x.name), ...(opener as object) };
      },
    },
    {
      id: 'trips.undo',
      title: 'Undo',
      description: 'Step the open trip back one edit — the same stack as ⌘Z, the agent’s writes included. Writes less than 0.7 s apart on one screen are one step.',
      available: () => (!open ? 'no trip is open' : history.canUndo ? true : 'nothing to undo'),
      run: () => {
        history.undo();
        return { undone: true };
      },
    },
    {
      id: 'trips.redo',
      title: 'Redo',
      description: 'Step the open trip forward again after an undo.',
      available: () => (!open ? 'no trip is open' : history.canRedo ? true : 'nothing to redo'),
      run: () => {
        history.redo();
        return { redone: true };
      },
    },
  ]);

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
      // Through the same path as "take theirs": `setOpen` alone left the
      // mirror on the undo stack, and one ⌘Z pushed it over the newer copy.
      if (r?.replaced) replaceOpen(r.doc);
    });
  }, [open, resume, clear]);

  // The gallery's «Trip settings…» opens the trip on its settings sheet: the
  // overview reads this as it mounts and says so, and it is dropped then, or
  // every return from a piece would open the sheet again.
  const [settingsOnOpen, setSettingsOnOpen] = useState<TripSettingsSection | null>(null);
  const settingsTaken = useCallback(() => setSettingsOnOpen(null), []);

  const handleOpen = useCallback((doc: TripDoc, settings?: TripSettingsSection) => {
    setSettingsOnOpen(settings ?? null);
    // The gallery lists what the store held when it MOUNTED, and the trip
    // that is open may carry edits the 800 ms debounce had not written yet:
    // taking the listed copy back put the screen a step behind, and the next
    // edit wrote that older trip over the newer one. The copy in memory is
    // kept unless the store's is genuinely newer (moved between sources).
    setOpen((cur) => (cur && cur.id === doc.id && cur.updatedAt >= doc.updatedAt ? cur : doc));
    loadedRef.current = tripRef(doc);
    navigate(roadtripPath(tripRef(doc)));
  }, []);

  /**
   * Move within the open trip without losing where you were. `replace`
   * rewrites the current step instead of adding one — a drag along the map
   * view's year strip walks many days and must leave ONE way back.
   */
  const go = useCallback(
    (date: IsoDate | null, postId: string | null = null, options?: { replace?: boolean }) => {
      if (!open) return;
      navigate(roadtripPath(tripRef(open), date, postId), options);
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

  /**
   * Deduce the legs from an instance's day positions. Unrelated to the
   * timeline and NOT behind its switch: this reads a date range, the way the
   * day view and the Library's Winnow tab always have.
   */
  const openDeduce = useCallback((sourceId: string) => {
    const connection = getWinnowConnection(sourceId);
    if (connection) setDeducing(connection);
  }, []);

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
      setDeducing(null);
      handleChange(doc);
      setSpanNote(
        spanWidened
          ? `The trip now runs ${doc.startDate} → ${doc.endDate}: its dates grew to hold a leg you accepted.`
          : null,
      );
    },
    [handleChange],
  );

  /**
   * A deduction WRITES and stays open — on its Written pane, with Undo and
   * Run again — so the modal closes only when the author closes it.
   */
  const handleWritten = useCallback(
    (doc: TripDoc, spanWidened: boolean) => {
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
  // Every connected instance can answer for a day's position: it is a date
  // filter, not a feature. Nothing is asked until the button is pressed.
  const deduceSources = connections.map((c) => c.id);

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
        />
      ) : editingPost ? (
        <PostEditor
          key={editingPost.id}
          trip={open}
          post={editingPost}
          onBack={() => go(editingPost.date)}
          onChangePost={updatePost}
          onChangeTrip={handleChange}
          headerExtra={
            <>
              {history.control}
              {sync.pill}
            </>
          }
          deduceSources={deduceSources}
          onDeduceFrom={openDeduce}
        />
      ) : (
        <TripOverview
          key={open.id}
          trip={open}
          initialSettings={settingsOnOpen}
          onSettingsTaken={settingsTaken}
          selectedDate={route.date}
          onSelectDate={(date, options) => go(date, null, options)}
          onShowTrips={() => navigate(HOME_ROUTE)}
          onChange={handleChange}
          onOpenPost={(post) => go(post.date, post.id)}
          headerExtra={
            <>
              {history.control}
              {sync.pill}
            </>
          }
          timelineSources={completeSources}
          onCompleteFrom={(id) => openImport('complete', id)}
          deduceSources={deduceSources}
          onDeduceFrom={openDeduce}
        />
      )}

      {/* A completion needs its trip loaded; a seed needs nothing open. */}
      {deducing && open && (
        <DeduceStagesPanel
          key={`deduce:${deducing.id}:${open.id}`}
          connection={deducing}
          trip={open}
          onCancel={() => setDeducing(null)}
          onWrite={handleWritten}
          onUndo={history.undo}
          canUndo={history.canUndo}
        />
      )}

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
