import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type Ref } from 'react';
import {
  listsBurstFrames,
  searchPaging,
  WinnowError,
  type LibraryHalf,
  type WinnowAssetRow,
  type WinnowCalendarDay,
  type WinnowClient,
  type WinnowSession,
} from '../client';
import type { WinnowConnection } from '../store';
import { readBrowseState, writeBrowseState } from '../browse-state';
import DayPicker from '../DayPicker';
import { describeCulling } from '../culling';
import MediaLightbox, { type LightboxItem } from '../../../ui/MediaLightbox';
import { formatIsoDate, todayIso } from '../../../roadtrip/trip-days';
import Button from '../../../ui/Button';
import IconButton from '../../../ui/IconButton';
import Segmented from '../../../ui/Segmented';
import SettingsMenu from '../../../ui/SettingsMenu';
import { localPref, useLocalPref } from '../../../ui/local-pref';
import { useIsCompact } from '../../../ui/use-layout-mode';
import LoadingState from '../../../ui/LoadingState';
import { Icons } from '../../../ui/icons';
import useDialogKeys from '../../../ui/use-dialog-keys';
import { revealInScroller } from '../../../ui/reveal';
import { useInViewport } from '../../../lib/use-in-viewport';
import PickerLogbook from './PickerLogbook';
import PickerMap from './PickerMap';
import PickerRail from './PickerRail';
import type { DescribeState, SubjectLists } from './PickerSubject';
import { kept, pageFor, wantsMore, type Reach } from './describe-reach';
import { instanceNames } from '../winnow-names';
import { readFlightLog } from './flight-logs';
import { logFailureOf, type LogFailure } from './log-failures';
import type { FlightTrack } from './flight-track';
import SpanPicker from './SpanPicker';
import { dayHeading, dayRuns, openingSpan, rowDay, spanChunks, spanDays, spanMonths, spanPresets, type SpanChunk } from './span';
import { nextParts, partOf, type PartState } from './span-queue';
import PickerTile, { type PileBadge } from './PickerTile';
import {
  activeFacets,
  describedRows,
  describedText,
  describePeopleAside,
  rankedShown,
  readsEnglishOnly,
  BUCKETS,
  DEFAULT_FACETS,
  drawn,
  facetCounts,
  framesUnder,
  hiddenTicked,
  idsFor,
  inverted,
  openingTicks,
  pickItem,
  pilesOf,
  serverFacets,
  subjectQuery,
  rangeTicked,
  shown,
  SHOW_ALL,
  surfaced,
  TICK_VERB_LABEL,
  withAll,
  withNoneShown,
  type PickFacets,
  type PickItem,
  type PickSort,
  type TickVerb,
} from './pick-filter';
import type { PickerAction, PickerHost } from './picker-host';

/** How many rows a scope may bring: a day is a few hundred, a folder a few thousand. */
const DAY_CAP = 600;
const FOLDER_CAP = 2000;
/**
 * A span is asked for in PARTS of about this many media (`spanChunks`, from
 * the instance's own day counts): the parts on screen or jumped to first,
 * then the rest in order (`span-queue.ts`) — never one capped walk, which
 * showed a year as its first weeks, and no longer oldest first only, which
 * made a click on a late month do nothing until everything before it landed.
 */
const SPAN_CHUNK = 1000;
/** Parts asked for at once. */
const SPAN_PARALLEL = 2;
/** Pages of the most the instance serves (its `PAGE_MAX`): a span is many of them. */
const SPAN_PAGE = 500;
/** Tiles mounted per batch, the next as the end of the grid nears. */
const BATCH = 240;

type Scope = 'day' | 'span' | 'session';

const SWATCH: Record<string, string> = {
  pick: 'bg-ok',
  star: 'bg-warn-bright',
  unrated: 'bg-faint',
  skip: 'bg-info',
  reject: 'bg-danger',
};

interface Problem {
  text: string;
  login?: string;
}

function explain(err: unknown, client: WinnowClient, host: string): Problem {
  if (err instanceof WinnowError && err.kind === 'unauthenticated') {
    return { text: `Not signed in to ${host}.`, login: client.loginUrl() };
  }
  return { text: err instanceof Error ? err.message : String(err) };
}

/** Whether a key press belongs to a field rather than to the grid. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/**
 * The Winnow picker — ONE modal for every place that takes media from an
 * instance: the Library's *browse all* and a Develop roll's *Add a day*
 * (`docs/winnow-day-sheet-verdicts.md` §7, his pick of the rail face).
 *
 * - **A scope**: a day, walked with the sidebar's own stepper and its month
 *   (bars or weeks, `DayPicker`), a SPAN of days (`span.ts` — a trip, a month
 *   of flights, listed as one scope and grouped by day), or a folder (a
 *   Winnow session), picked from a list under the same control. The library half narrows the scope on the
 *   server; everything else is the rail's, over the rows (`pick-filter.ts`).
 * - **Winnow's word on every tile** — flag, stars, label, a Gallery final —
 *   and a rail of facets with the scope's counts.
 * - **A bar that TICKS** — All, None, Invert, Picks, ★5, ★4+ — over what is
 *   drawn, never a verdict written: culling is Winnow's. Then the HOST's
 *   verbs (`PickerHost`), the only thing the two places do differently.
 *
 * It fetches only the list and the tiles' thumbnails; what an action does
 * with the ticked rows is the host's.
 */
type TileSize = 's' | 'm' | 'l';
const readTiles = (raw: string | null): TileSize => (raw === 's' || raw === 'l' ? raw : 'm');
const tilesPref = localPref<TileSize>('atelier.winnow.picker.tiles', readTiles, (v) => (v === 'm' ? null : v));
const railPref = localPref<boolean>('atelier.winnow.picker.rail', (raw) => raw !== 'folded', (v) => (v ? null : 'folded'));
type GridView = 'grid' | 'book' | 'map';
const readView = (raw: string | null): GridView => (raw === 'book' || raw === 'map' ? raw : 'grid');
const viewPref = localPref<GridView>('atelier.winnow.picker.view', readView, (v) => (v === 'grid' ? null : v));
/**
 * Rows pinned in pixels: an `auto` row in a scrolling tile grid is clipped
 * to a sliver (`frontend.md`). Whole strings, so Tailwind sees each class.
 */
const TILE_GRID: Record<TileSize, string> = {
  s: 'grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] auto-rows-[4.5rem] max-[820px]:grid-cols-4 max-[820px]:auto-rows-[4.2rem]',
  m: 'grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] auto-rows-[6rem] max-[820px]:grid-cols-3 max-[820px]:auto-rows-[5.6rem]',
  l: 'grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] auto-rows-[8.25rem] max-[820px]:grid-cols-2 max-[820px]:auto-rows-[8rem]',
};

export default function WinnowPicker({
  connection,
  client,
  host,
  onClose,
}: {
  connection: WinnowConnection;
  client: WinnowClient;
  host: PickerHost;
  onClose: () => void;
}) {
  const remembered = useMemo(() => readBrowseState(connection.id), [connection.id]);

  // --- the scope -------------------------------------------------------------
  // Opens on the host's day (or its span, when it asks for one): the host
  // knows what the person is looking at. The folder, the last span, the half
  // (unless the host names one) and the rail come back from the last sitting
  // on this instance.
  const [scope, setScope] = useState<Scope>(host.start.scope === 'span' ? 'span' : 'day');
  const [day, setDay] = useState(host.start.day);
  const today = todayIso();
  const [span, setSpan] = useState(() => openingSpan(host.start.day, today, host.start.span, remembered?.span));
  const [half, setHalf] = useState<LibraryHalf | null>(() =>
    host.start.half !== undefined ? host.start.half : (remembered?.filter.half ?? null),
  );
  const [sessionId, setSessionId] = useState<number | null>(remembered?.sessionId ?? null);
  const [facets, setFacets] = useState<PickFacets>(remembered?.facets ?? DEFAULT_FACETS);
  const [sort, setSort] = useState<PickSort>(remembered?.sort ?? 'time');

  const [rows, setRows] = useState<WinnowAssetRow[] | null>(null);
  // The scope's list is whole (every part landed), and whether it stopped at its cap.
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  // A span's day counts, as the instance's calendar answered them.
  const [spanCounts, setSpanCounts] = useState<WinnowCalendarDay[] | null>(null);
  // A span's parts, what each is doing, and the rows each brought (`span-queue.ts`).
  const [parts, setParts] = useState<SpanChunk[] | null>(null);
  const [partStates, setPartStates] = useState<PartState[]>([]);
  const [partRows, setPartRows] = useState<ReadonlyMap<number, WinnowAssetRow[]>>(new Map());
  // The parts the grid shows or was sent to, most wanted first, and the day a month click went to.
  const [wantedParts, setWantedParts] = useState<number[]>([]);
  const [jumpDay, setJumpDay] = useState<string | null>(null);
  const partAsks = useRef(new Map<number, AbortController>());
  const spanAsk = useRef<{ narrowing: Record<string, unknown>; key: number }>({ narrowing: {}, key: 0 });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [generation, setGeneration] = useState(0);
  // Every frame of a pile, where the instance says it can list them (Winnow
  // #277, `collapse=pairs`): a frame elected inside a pile is never its
  // cover, so the fold would hide exactly what a culled day is opened for.
  // An instance that predates it folds piles, and a pile's frames are asked
  // for when it is unfolded (`burstId`).
  const framesListed = listsBurstFrames(connection.capabilities);
  // A span asks the server for only what the rail keeps (`serverFacets`): a
  // year of everything is tens of thousands of rows, a year of one drone's
  // clips a few hundred. The host's own narrowing wins over the rail's.
  const asked = scope === 'span' ? serverFacets(facets) : {};
  const mediaType = host.narrow?.mediaType ?? asked.mediaType;
  const device = asked.device;
  // The SUBJECT — people, words, a place — goes to the server with EVERY scope (`PickerSubject`): a row carries no
  // person, and a span's parts would be cut by their caps before a filter here saw them.
  const subject = useMemo(() => subjectQuery(facets), [facets]);
  const subjectKey = JSON.stringify(subject);

  // What names the scope being listed: every reset keys on it, never on the
  // rows, which a span receives part by part.
  const scopeKey = `${scope}|${day}|${span.from}|${span.to}|${sessionId}|${half}|${mediaType}|${device}|${subjectKey}|${generation}`;
  // The same WITHOUT what the rail narrows a span by: a facet click re-asks
  // the server, but a ticked row it hides stays ticked, as in a day or a
  // folder — the ticks reset on a new PLACE only.
  const placeKey = `${scope}|${day}|${span.from}|${span.to}|${sessionId}|${half}|${host.narrow?.mediaType}|${generation}`;

  // The scope's rows, every page. A change of scope forgets the last answer
  // first, so a new day never shows the previous one's pictures for a frame.
  useEffect(() => {
    setRows(null);
    setLoaded(false);
    setTruncated(false);
    setSpanCounts(null);
    setParts(null);
    setPartStates([]);
    setPartRows(new Map());
    setWantedParts([]);
    setJumpDay(null);
    setProblem(null);
    if (scope === 'session' && sessionId === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;
    const filter = { ...(half ? { half } : {}), ...(mediaType ? { mediaType } : {}), ...(device ? { device } : {}), ...subject };
    const narrowing = { ...filter, bursts: framesListed ? ('frames' as const) : ('fold' as const) };
    const fail = (err: unknown) => {
      if (cancelled) return;
      setRows((cur) => cur ?? []);
      setLoaded(true);
      setProblem(explain(err, client, connection.id));
    };
    if (scope !== 'span') {
      const cap = scope === 'session' ? FOLDER_CAP : DAY_CAP;
      const ask =
        scope === 'session'
          ? client.allAssets({ sessionId: sessionId!, ...narrowing }, cap, signal)
          : client.allAssets({ dateFrom: day, dateTo: day, ...narrowing }, cap, signal);
      ask
        .then((all) => {
          if (cancelled) return;
          setRows(all);
          setTruncated(all.length >= cap);
          setLoaded(true);
        })
        .catch(fail);
    } else {
      // A span: its day counts first (one request), which give every day its
      // place in the grid at once; the parts are then asked for by the queue below.
      spanAsk.current = { narrowing, key: spanAsk.current.key + 1 };
      void (async () => {
        const calendar = await client.calendar(span.from, span.to, filter, signal);
        if (cancelled) return;
        const cut = spanChunks(calendar.days, { from: span.from, to: span.to }, SPAN_CHUNK);
        setSpanCounts(calendar.days);
        setParts(cut);
        setPartStates(cut.map(() => 'idle'));
        setRows([]);
        if (cut.length === 0) setLoaded(true);
      })().catch(fail);
    }
    const asks = partAsks.current;
    return () => {
      cancelled = true;
      controller.abort();
      for (const c of asks.values()) c.abort();
      asks.clear();
    };
    // `subject` is read through its key: the object is rebuilt with the facets, the ask only when it changes.
  }, [client, connection.id, scope, day, span.from, span.to, sessionId, half, mediaType, device, subjectKey, generation, framesListed]);

  // A span's parts, asked for by the queue: wanted first, two at a time, the
  // rest in order; a part nobody looks at any more gives its slot up.
  useEffect(() => {
    if (scope !== 'span' || !parts) return;
    const step = nextParts(partStates, wantedParts, SPAN_PARALLEL);
    if (!step.start.length && !step.abort.length) return;
    const key = spanAsk.current.key;
    for (const i of step.abort) {
      partAsks.current.get(i)?.abort();
      partAsks.current.delete(i);
    }
    setPartStates((cur) => cur.map((st, i) => (step.abort.includes(i) ? 'idle' : step.start.includes(i) ? 'loading' : st)));
    for (const i of step.start) {
      const ask = new AbortController();
      partAsks.current.set(i, ask);
      const part = parts[i];
      client
        .allAssets({ dateFrom: part.from, dateTo: part.to, ...spanAsk.current.narrowing, limit: SPAN_PAGE }, Math.max(SPAN_PAGE, part.count * 2 + 200), ask.signal)
        .then((got) => {
          if (ask.signal.aborted || key !== spanAsk.current.key) return;
          partAsks.current.delete(i);
          setPartRows((cur) => new Map(cur).set(i, got));
          setPartStates((cur) => cur.map((st, k) => (k === i ? 'done' : st)));
        })
        .catch((err: unknown) => {
          if (ask.signal.aborted || key !== spanAsk.current.key) return;
          partAsks.current.delete(i);
          setPartStates((cur) => cur.map((st, k) => (k === i ? 'failed' : st)));
          setProblem(explain(err, client, connection.id));
        });
    }
  }, [scope, parts, partStates, wantedParts, client, connection.id]);
  // The rows the landed parts brought, in the span's order; whole once every part is in.
  useEffect(() => {
    if (scope !== 'span' || !parts) return;
    const all: WinnowAssetRow[] = [];
    parts.forEach((_, i) => {
      const got = partRows.get(i);
      if (got) all.push(...got);
    });
    setRows(all);
    if (parts.length && partStates.every((st) => st === 'done')) setLoaded(true);
  }, [scope, parts, partRows, partStates]);

  // A folded pile's frames, asked for on its unfold where the scope's list
  // could not carry them. Forgotten with the scope.
  const [pileRows, setPileRows] = useState<ReadonlyMap<number, WinnowAssetRow[]>>(new Map());
  const [pileAsking, setPileAsking] = useState<ReadonlySet<number>>(new Set());
  // The scope's pile asks share one signal: a new scope, or the picker closing, aborts them all.
  const pileSignal = useRef(new AbortController());
  useEffect(() => {
    setPileRows(new Map());
    setPileAsking(new Set());
    const controller = new AbortController();
    pileSignal.current = controller;
    return () => controller.abort();
  }, [scopeKey]);
  const askPile = (pileId: number) => {
    if (pileAsking.has(pileId)) return;
    setPileAsking((cur) => new Set(cur).add(pileId));
    const { signal } = pileSignal.current;
    client
      .allAssets({ burstId: pileId, ...(half ? { half } : {}) }, 200, signal)
      .then((list) => !signal.aborted && setPileRows((cur) => new Map(cur).set(pileId, list)))
      .catch((err: unknown) => !signal.aborted && setProblem(explain(err, client, connection.id)))
      .finally(() =>
        setPileAsking((cur) => {
          const next = new Set(cur);
          next.delete(pileId);
          return next;
        }),
      );
  };
  /** The scope's rows and the frames unfolded piles brought, once each. */
  const listed = useMemo(() => {
    if (!rows || pileRows.size === 0) return rows;
    const seen = new Set(rows.map((r) => r.id));
    const extra: WinnowAssetRow[] = [];
    for (const list of pileRows.values()) {
      for (const r of list) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        extra.push(r);
      }
    }
    return [...rows, ...extra];
  }, [rows, pileRows]);

  // The folders, under the same half, asked for when the folder scope is up.
  const [sessions, setSessions] = useState<WinnowSession[] | null>(null);
  useEffect(() => {
    if (scope !== 'session') return;
    const controller = new AbortController();
    let cancelled = false;
    setSessions(null);
    client
      .sessions(half ? { half } : {}, controller.signal)
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSessions([]);
        setProblem(explain(err, client, connection.id));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, connection.id, scope, half]);

  // Remember the place: read back what is stored first, so what this sheet
  // does not own (the Library's fidelity, a month) survives the write.
  useEffect(() => {
    const stored = readBrowseState(connection.id);
    const filter = { ...(stored?.filter ?? {}) };
    delete filter.half;
    if (half) filter.half = half;
    writeBrowseState(connection.id, {
      view: scope,
      filter,
      month: day.slice(0, 7),
      day,
      sessionId,
      chapterId: stored?.chapterId ?? null,
      span,
      fidelity: stored?.fidelity ?? 'proxy',
      facets,
      sort,
    });
  }, [connection.id, scope, day, span, half, sessionId, facets, sort]);

  // --- a DESCRIPTION is a scope of its own ------------------------------------
  // His ask of 2026-11-03 (the Words field's default), fixed the same day after «la recherche par mot clé ml ne
  // fonctionne pas»: Winnow's `/api/search` ranks the WHOLE library (the half at most, never a day) and answers its
  // 200 closest, so keeping only those inside the open day or span left a real library with nothing. The ranking IS
  // the list while it stands — the day, span or folder set aside and said so, the rail's facets and place ticks
  // still narrowing it. One ask per description, half and REACH (2026-11-05, `describe-reach.ts`): Precise reads the
  // 200 closest, Broad reads page after page while the rows stay near the best one — the instrument picks the
  // default (`host.reach`, a mosaic Broad), the person may switch it for a search; an instance that does not page
  // (`searchPaging`) hands one page of 200 whatever the reach, and the rail says so.
  const describing = describedText(facets);
  const paging = useMemo(() => searchPaging(connection.capabilities), [connection.capabilities]);
  const [reach, setReach] = useState<Reach>(host.reach ?? 'precise');
  const rankKey = describing ? `${half ?? 'all'}|${reach}|${describing}` : '';
  const [ranking, setRanking] = useState<{
    key: string;
    rows: (WinnowAssetRow & { distance: number })[];
    enabled: boolean;
    reason: string | null;
    indexed: number | null;
    library: number | null;
    model: string | null;
    /** Broad wanted more than this instance hands (it does not page). */
    short: boolean;
  } | null>(null);
  useEffect(() => {
    if (!rankKey) return;
    const ctl = new AbortController();
    const limit = pageFor(reach, paging.pageSize);
    void (async () => {
      try {
        let found = await client.search(describing, { limit, ...(half ? { half } : {}) }, ctl.signal);
        const rows = [...found.items];
        while (found.enabled && paging.pages && wantsMore(rows, reach, found.nextOffset) && !ctl.signal.aborted) {
          found = await client.search(describing, { limit, offset: found.nextOffset ?? rows.length, ...(half ? { half } : {}) }, ctl.signal);
          rows.push(...found.items);
        }
        if (ctl.signal.aborted) return;
        const short = reach === 'broad' && !paging.pages && rows.length >= limit;
        setRanking({ key: rankKey, rows: kept(rows, reach), enabled: found.enabled, reason: found.reason, indexed: found.indexed, library: found.library, model: found.model, short });
      } catch (err) {
        if (ctl.signal.aborted) return;
        setRanking({ key: rankKey, rows: [], enabled: false, reason: err instanceof Error ? err.message : String(err), indexed: null, library: null, model: null, short: false });
      }
    })();
    return () => ctl.abort();
  }, [client, rankKey, describing, half, reach, paging]);
  const ranked = rankKey && ranking?.key === rankKey ? ranking : null;
  const rankedRows = useMemo(() => (ranked?.enabled ? describedRows(ranked.rows, facets) : null), [ranked, facets]);
  const distances = useMemo(() => new Map((ranked?.rows ?? []).map((r) => [r.id, r.distance])), [ranked]);

  // --- what the grid holds ---------------------------------------------------
  const items = useMemo<PickItem[]>(
    () =>
      ((rankKey ? rankedRows : listed) ?? []).filter((r) => !host.accepts || host.accepts(r)).map((r) => pickItem(r, host.held(r))),
    [rankKey, rankedRows, listed, host],
  );
  const piles = useMemo(() => pilesOf(items), [items]);
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  const surfacedItems = useMemo(() => surfaced(items, piles, unfolded), [items, piles, unfolded]);
  // Counted with every pile folded, so unfolding one never moves a number.
  const counts = useMemo(() => facetCounts(surfaced(items, piles, new Set())), [items, piles]);
  // The instance's own lists, read once a sitting (`instanceNames` keeps them ten minutes): its people and its place
  // names for the rail's Subject, and its bodies — a span narrowed to some bodies on the server holds no row of the
  // others, so the rail lists them beside (at zero): ticking another asks for it, unticking them all asks for everything.
  const [subjectLists, setSubjectLists] = useState<SubjectLists>({ people: null, names: null });
  useEffect(() => {
    let cancelled = false;
    void instanceNames(client).then(
      (names) => !cancelled && setSubjectLists((cur) => ({ ...cur, names })),
      () => !cancelled && setSubjectLists((cur) => ({ ...cur, names: { media_types: [], extensions: [], devices: [], lenses: [], place_countries: [], place_regions: [], place_cities: [], place_pois: [] } })),
    );
    // An instance from before Winnow's faces answers 404: no People section, nothing said.
    void client.people().then(
      (people) => !cancelled && setSubjectLists((cur) => ({ ...cur, people })),
      () => !cancelled && setSubjectLists((cur) => ({ ...cur, people: [] })),
    );
    return () => {
      cancelled = true;
    };
  }, [client]);
  const bodies = useMemo(() => subjectLists.names?.devices.map((d) => String(d.value)) ?? null, [subjectLists.names]);
  const railCounts = useMemo(() => {
    if (!device || !bodies?.length) return counts;
    const devices = new Map(counts.devices);
    for (const b of bodies) if (!devices.has(b)) devices.set(b, 0);
    return { ...counts, devices };
  }, [counts, device, bodies]);
  const shownItems = useMemo(() => {
    const base = shown(surfacedItems, facets, sort, piles);
    return rankKey ? rankedShown(base, distances) : base;
  }, [surfacedItems, facets, sort, piles, rankKey, distances]);
  const drawnItems = useMemo(() => drawn(shownItems, items, piles, unfolded), [shownItems, items, piles, unfolded]);
  const describe = useMemo<DescribeState>(
    () => ({
      text: describing,
      state: !rankKey ? 'idle' : !ranked ? 'asking' : !ranked.enabled ? 'off' : ranked.indexed === 0 ? 'empty' : 'ready',
      ranked: ranked?.rows.length ?? 0,
      indexed: ranked?.indexed ?? null,
      library: ranked?.library ?? null,
      reason: ranked?.reason ?? null,
      englishOnly: readsEnglishOnly(ranked?.model),
      peopleAside: describePeopleAside(facets),
      scopeWord: scope === 'span' ? 'span' : scope === 'session' ? 'folder' : 'day',
      reach,
      short: ranked?.short ?? false,
    }),
    [describing, rankKey, ranked, facets, scope, reach],
  );

  // --- flight tracks ---------------------------------------------------------
  // Read on request (each log is a download, however small), for the clips
  // the grid DRAWS, once per session (`flight-logs.ts`).
  const [tracksOn, setTracksOn] = useState(host.start.tracks ?? false);
  const [tracks, setTracks] = useState<ReadonlyMap<number, FlightTrack | null>>(new Map());
  // Logs the instance could not hand over — never drawn as a flight with no
  // fix, which is what hid a drive that was not plugged in (`log-failures.ts`).
  const [missing, setMissing] = useState<ReadonlyMap<number, LogFailure>>(new Map());

  // --- ticks -----------------------------------------------------------------
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  // Seeded once a scope's list is WHOLE (a span lands part by part), never
  // on a facet or a tick: the opening rule describes a scope, not a view of
  // it. What was ticked while the parts landed is kept.
  const latest = useRef({ host, piles, rows });
  latest.current = { host, piles, rows };
  useEffect(() => {
    setUnfolded(new Set());
    setAnchorId(null);
    setFocusId(null);
    setTicked(new Set());
  }, [placeKey]);
  useEffect(() => {
    if (!loaded) return;
    const { host: h, rows: all } = latest.current;
    if (!all) return;
    const list = all.filter((r) => !h.accepts || h.accepts(r)).map((r) => pickItem(r, h.held(r)));
    const open = openingTicks(h.openTicks, surfaced(list, pilesOf(list), new Set()));
    setTicked((cur) => (open.size ? new Set([...cur, ...open]) : cur));
  }, [loaded, scopeKey]);

  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const tickedRows = useMemo(
    () => [...ticked].flatMap((id) => {
      const it = byId.get(id);
      return it && !it.held ? [it.row] : [];
    }),
    [ticked, byId],
  );
  const hidden = hiddenTicked(new Set(tickedRows.map((r) => r.id)), drawnItems);

  const [say, setSay] = useState<string | null>(null);
  const sayTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((text: string) => {
    setSay(text);
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setSay(null), 1800);
  }, []);
  useEffect(() => () => window.clearTimeout(sayTimer.current), []);

  const tickBy = useCallback(
    (verb: TickVerb, add: boolean) => {
      const ids = idsFor(verb, drawnItems);
      setTicked((cur) => {
        const next = add ? new Set(cur) : new Set<number>();
        for (const id of ids) next.add(id);
        return next;
      });
      flash(`${add ? 'Added' : 'Ticked'} ${ids.length} ${TICK_VERB_LABEL[verb]} of the ${drawnItems.length} shown`);
    },
    [drawnItems, flash],
  );

  const toggle = (it: PickItem, e: MouseEvent) => {
    if (it.held) return;
    setTicked((cur) => {
      if (e.shiftKey && anchorId !== null) return rangeTicked(cur, drawnItems, anchorId, it.id);
      const next = new Set(cur);
      if (next.has(it.id)) next.delete(it.id);
      else next.add(it.id);
      return next;
    });
    setAnchorId(it.id);
    setFocusId(it.id);
  };

  // --- the host's verbs ------------------------------------------------------
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Any other way out (a route change, the host unmounting the sheet) stops
  // an action in flight rather than letting it land later.
  useEffect(() => () => controller.current?.abort(), []);

  const can = (action: PickerAction) => tickedRows.length > 0 && (action.enabled?.(tickedRows) ?? true);
  const run = async (action: PickerAction) => {
    if (!can(action) || running) return;
    const c = new AbortController();
    controller.current = c;
    setRunning(action.key);
    setProblem(null);
    try {
      const done = await action.run(tickedRows, { signal: c.signal, progress: setProgress });
      if (done === true && !c.signal.aborted) onClose();
    } catch (err) {
      if (!c.signal.aborted) setProblem(explain(err, client, connection.id));
    } finally {
      if (controller.current === c) controller.current = null;
      setRunning(null);
      setProgress(null);
    }
  };
  const primary = host.actions[host.actions.length - 1] ?? null;

  const close = () => {
    controller.current?.abort();
    onClose();
  };

  // A tile looked at large, an index into what is drawn — the lightbox pages
  // through exactly the grid's order.
  const [peek, setPeek] = useState<number | null>(null);
  // What the lightbox draws for each drawn tile: the proxy over the thumbnail,
  // Winnow's word and the body in the facts line. Built only while a picture
  // is looked at: the drawn list changes on every facet click and span part.
  const looking = peek !== null;
  const lookItems = useMemo<LightboxItem[]>(
    () =>
      !looking
        ? []
        : drawnItems.map(({ row, culling, device }) => ({
            id: String(row.id),
            title: row.filename,
            facts: [describeCulling(culling) || 'not culled', device, row.capture_date ? formatIsoDate(row.capture_date) : null]
              .filter(Boolean)
              .join(' · '),
            kind: row.media_type === 'video' ? 'video' : 'photo',
            src: client.proxyUrl(row.id),
            still: client.thumbUrl(row.id),
            natural: row.width && row.height ? { width: row.width, height: row.height } : null,
            credentialed: true,
          })),
    [drawnItems, client, looking],
  );
  const look = (id: number) => {
    const at = drawnItems.findIndex((it) => it.id === id);
    if (at >= 0) setPeek(at);
    setFocusId(id);
    // The tile behind keeps the focus otherwise, and Enter would click it
    // instead of ticking the picture on screen.
    (document.activeElement as HTMLElement | null)?.blur();
  };

  // While a picture is looked at large, Escape and Enter are the lightbox's.
  useDialogKeys({
    onCancel: peek === null ? close : undefined,
    onConfirm: peek === null && primary && can(primary) && !running ? () => void run(primary) : null,
  });

  // The grid's own keys: the bulk verbs, Winnow-style. A field keeps its keys,
  // and a press another surface claimed (a popover) is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (peek !== null || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'p') tickBy('picks', e.shiftKey);
      else if (e.code === 'Digit5') tickBy('stars5', e.shiftKey);
      else if (e.code === 'Digit4') tickBy('stars4', e.shiftKey);
      else if (e.code === 'Digit3') tickBy('stars3', e.shiftKey);
      else if (k === 'a') setTicked((cur) => withAll(cur, drawnItems));
      else if (k === 'n') setTicked((cur) => withNoneShown(cur, drawnItems));
      else if (k === 'i') setTicked((cur) => inverted(cur, drawnItems));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tickBy, drawnItems, peek]);

  useEffect(() => {
    // Under 820px this is a full-screen sheet, and a page still scrolling
    // behind it drags the whole screen while the grid is swiped.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // --- the grid's batches ----------------------------------------------------
  const [limit, setLimit] = useState(BATCH);
  useEffect(() => setLimit(BATCH), [scopeKey, facets, sort]);

  // A long span's months, and a jump to one: the batch grows to reach the
  // month's first row, then the grid scrolls to its first day heading.
  const months = useMemo(
    () => (spanCounts ? spanMonths(spanCounts, { from: span.from, to: span.to }) : []),
    [spanCounts, span.from, span.to],
  );
  const landedThrough = rows?.length ? rowDay(rows[rows.length - 1]) : null;
  const gridBox = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<string | null>(null);
  const jumpTo = (month: string) => {
    if (virtual) {
      // Every day of a span has its section from the calendar's counts: go there now, its part asked first.
      const target = spanDayList.find((d) => d.date >= month);
      if (!target) return;
      setJumpDay(target.date);
      const el = gridBox.current?.querySelector<HTMLElement>(`[data-span-day="${target.date}"]`);
      if (el) revealInScroller(el, { block: 'start', scroller: gridBox.current });
      return;
    }
    const at = shownItems.findIndex((it) => (rowDay(it.row) ?? '') >= month);
    if (at < 0) return;
    setLimit((n) => Math.max(n, at + BATCH));
    setJump(rowDay(shownItems[at].row));
  };
  useEffect(() => {
    if (!jump) return;
    const el = gridBox.current?.querySelector<HTMLElement>(`[data-day="${jump}"]`);
    if (el) {
      revealInScroller(el, { block: 'start', scroller: gridBox.current });
      setJump(null);
    }
  });

  useEffect(() => {
    if (!tracksOn) return;
    let alive = true;
    for (const it of shownItems.slice(0, limit)) {
      if (it.log !== 'with') continue;
      readFlightLog(client, it.row)
        ?.then((log) => {
          if (!alive) return;
          setTracks((cur) => (cur.get(it.id) === log.track ? cur : new Map(cur).set(it.id, log.track)));
          setMissing((cur) => {
            if (!cur.has(it.id)) return cur;
            const next = new Map(cur);
            next.delete(it.id);
            return next;
          });
        })
        .catch((err: unknown) => {
          const why = logFailureOf(err);
          if (alive) setMissing((cur) => (cur.get(it.id) === why ? cur : new Map(cur).set(it.id, why)));
        });
    }
    return () => {
      alive = false;
    };
  }, [tracksOn, shownItems, limit, client]);

  // `Tracks · read/with a log`, and what the instance could not hand over.
  const withLogs = shownItems.filter((it) => it.log === 'with');
  const missed = withLogs.filter((it) => missing.has(it.id)).length;
  const tracksLabel = `Tracks · ${withLogs.filter((it) => tracks.has(it.id) && !missing.has(it.id)).length}/${withLogs.length}${missed ? ` · ${missed} missing` : ''}`;

  const [railOpen, setRailOpen] = useState(false);
  // The grid's own view, per device (the panel's tiles and the rail's
  // column); a phone's rail is a sheet and never a column.
  const [tiles, setTiles] = useLocalPref(tilesPref, 'm');
  const [railShown, setRailShown] = useLocalPref(railPref, true);
  // Grid or Logbook: the device's choice, unless the host opened on one.
  const [prefView, setPrefView] = useLocalPref(viewPref, 'grid');
  const [hostView, setHostView] = useState<GridView | null>(host.start.view ?? null);
  const view = hostView ?? prefView;
  const pickView = (v: GridView) => {
    setHostView(null);
    setPrefView(v);
  };
  const phone = useIsCompact();
  const openFilters = () => (phone ? setRailOpen(true) : setRailShown(true));
  const active = activeFacets(facets);
  const session = sessions?.find((s) => s.id === sessionId) ?? null;
  const asking = rows === null && problem === null && !(scope === 'session' && sessionId === null);
  // A list that reached its scope's ceiling is a list cut short: said, never silent.
  const capped = truncated;
  // A span still landing: how much of what the calendar counted is here.
  const spanTotal = spanCounts ? spanCounts.reduce((n, d) => n + d.count, 0) : null;
  const landing = scope === 'span' && !loaded && rows !== null && problem === null;
  // The host's own spans first among the presets — its leg, its open span.
  const presets = useMemo(() => {
    const a = host.anchor;
    const own = [
      ...(a?.within ? [{ label: a.within.label, span: a.within.span }] : []),
      ...(a && spanDays(a.span) > 1 ? [{ label: a.label, span: a.span }] : []),
    ];
    return spanPresets(today, own);
  }, [host.anchor, today]);
  // Several days in one grid read under day headings, in the list's own order.
  // A description's order is the match's, closest first: no day headings while it stands.
  const grouped = scope !== 'day' && sort === 'time' && !rankKey;
  // A span's grid is VIRTUAL: every day the calendar counted has its section at
  // its real height from the first moment, so the scrollbar knows the year and
  // a month click lands at once; only the sections near the view mount tiles.
  const virtual = scope === 'span' && grouped && view === 'grid' && parts !== null;
  const spanDayList = useMemo(
    () => (spanCounts ? spanCounts.filter((d) => d.count > 0 && d.date >= span.from && d.date <= span.to).sort((a, b) => (a.date < b.date ? -1 : 1)) : []),
    [spanCounts, span.from, span.to],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, PickItem[]>();
    if (!virtual) return m;
    for (const it of shownItems) {
      const d = rowDay(it.row);
      if (!d) continue;
      const list = m.get(d);
      if (list) list.push(it);
      else m.set(d, [it]);
    }
    return m;
  }, [virtual, shownItems]);
  const [nearDays, setNearDays] = useState<ReadonlySet<string>>(new Set());
  const [cell, setCell] = useState({ cols: 6, row: 96, gap: 8, pad: 8 });
  const measureRef = useRef<HTMLUListElement>(null);
  // The grid's real columns and rows, read from a hidden grid of the same classes, as the box resizes.
  useEffect(() => {
    if (!virtual) return;
    const box = gridBox.current;
    const probe = measureRef.current;
    if (!box || !probe) return;
    const read = () => {
      const cs = getComputedStyle(probe);
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      const row = parseFloat(cs.gridAutoRows) || 96;
      const gap = parseFloat(cs.rowGap) || 0;
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      setCell((was) => (was.cols === cols && was.row === row && was.gap === gap && was.pad === pad ? was : { cols, row, gap, pad }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, [virtual, tiles]);
  const blockHeight = (n: number) => {
    const rowsN = Math.ceil(n / cell.cols);
    return rowsN ? rowsN * cell.row + (rowsN - 1) * cell.gap + cell.pad : 0;
  };
  // Which sections are near the view: those mount tiles, and their parts are wanted.
  const daysKey = spanDayList.map((d) => d.date).join(',');
  useEffect(() => {
    if (!virtual) return;
    const box = gridBox.current;
    if (!box) return;
    const near = new Set<string>();
    let frame = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const d = (e.target as HTMLElement).dataset.spanDay;
          if (!d) continue;
          if (e.isIntersecting) near.add(d);
          else near.delete(d);
        }
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => setNearDays(new Set(near)));
      },
      { root: box, rootMargin: '1200px 0px' },
    );
    box.querySelectorAll<HTMLElement>('[data-span-day]').forEach((el) => io.observe(el));
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, [virtual, daysKey]);
  // Wanted: the part a month click went to, then the parts on screen, in order.
  useEffect(() => {
    if (!virtual || !parts) return;
    const want: number[] = [];
    if (jumpDay) want.push(partOf(parts, jumpDay));
    for (const d of spanDayList) if (nearDays.has(d.date)) want.push(partOf(parts, d.date));
    const next = [...new Set(want.filter((i) => i >= 0))];
    setWantedParts((cur) => (cur.length === next.length && cur.every((v, i) => v === next[i]) ? cur : next));
  }, [virtual, parts, jumpDay, nearDays, spanDayList]);
  const partDone = (d: string) => !!parts && partStates[partOf(parts, d)] === 'done';
  // What the person is looking at stays put while parts above it land and
  // change heights: the first day in view and its offset, kept on scroll and
  // given back after each change (the browser's own anchoring loses it when a
  // spacer becomes a grid).
  const anchor = useRef<{ day: string; off: number } | null>(null);
  useEffect(() => {
    if (!virtual) return;
    const box = gridBox.current;
    if (!box) return;
    let frame = 0;
    const read = () => {
      const top = box.getBoundingClientRect().top;
      for (const el of box.querySelectorAll<HTMLElement>('[data-span-day]')) {
        if (el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > top + 1) {
          anchor.current = { day: el.dataset.spanDay!, off: r.top - top };
          return;
        }
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    read();
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      box.removeEventListener('scroll', onScroll);
    };
  }, [virtual]);
  useLayoutEffect(() => {
    if (!virtual || jumpDay) return;
    const box = gridBox.current;
    const a = anchor.current;
    if (!box || !a || box.scrollTop === 0) return;
    const el = box.querySelector<HTMLElement>(`[data-span-day="${a.day}"]`);
    if (!el || el.hidden) return;
    const off = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (Math.abs(off - a.off) > 1) box.scrollTop += off - a.off;
  }, [virtual, jumpDay, rows, partStates, nearDays, cell]);
  // A month click keeps its day at the top while the parts around it land and
  // change heights, and is answered once that day's own rows are drawn.
  useLayoutEffect(() => {
    if (!jumpDay || !virtual || !parts) return;
    const el = gridBox.current?.querySelector<HTMLElement>(`[data-span-day="${jumpDay}"]`);
    if (el) revealInScroller(el, { block: 'start', scroller: gridBox.current });
    const done = partStates[partOf(parts, jumpDay)] === 'done';
    if (done && (byDay.has(jumpDay) || rows !== null)) {
      const id = requestAnimationFrame(() => setJumpDay(null));
      return () => cancelAnimationFrame(id);
    }
  }, [jumpDay, virtual, parts, partStates, byDay, rows, cell]);

  const pileBadge = (it: PickItem, inRow: boolean): PileBadge | null => {
    if (it.pileId === null) return null;
    const pile = piles.get(it.pileId);
    if (!pile) return null;
    const open = unfolded.has(pile.id);
    const flip = () => {
      // Unfolding a pile whose frames the list did not carry asks for them.
      if (!open && pile.frameIds.length < pile.size && !pileRows.has(pile.id) && !pileAsking.has(pile.id)) askPile(pile.id);
      setUnfolded((cur) => {
        const next = new Set(cur);
        if (next.has(pile.id)) next.delete(pile.id);
        else next.add(pile.id);
        return next;
      });
    };
    if (pile.coverId === it.id) {
      const picks = pile.frameIds.filter((id) => byId.get(id)?.bucket === 'pick').length;
      return {
        label: `${pile.size}${picks ? ` · ${picks}⚑` : ''}`,
        title: open ? 'Fold the burst' : `Unfold the burst — ${pile.size} frames`,
        onClick: flip,
      };
    }
    if (inRow) return null;
    return {
      label: `${pile.frameIds.indexOf(it.id) + 1}/${pile.size}`,
      title: `A frame of a burst of ${pile.size} — unfold it`,
      onClick: flip,
    };
  };

  const tile = (it: PickItem, inRow = false) => (
    <PickerTile
      key={it.id}
      item={it}
      client={client}
      ticked={ticked.has(it.id)}
      focused={focusId === it.id}
      heldLabel={host.heldLabel}
      pile={pileBadge(it, inRow)}
      onToggle={(e) => toggle(it, e)}
      onLook={() => look(it.id)}
      track={tracksOn ? tracks.get(it.id) : undefined}
      logMissing={tracksOn && missing.has(it.id)}
      // A frame of an unfolded burst is as tall as its row leaves it (the row
      // is one of the grid's, pinned in pixels): a fixed `h-24` was taller
      // than that row less its padding, and every frame lost its top and
      // bottom, the focus ring with them.
      className={inRow ? 'h-full aspect-[4/3] shrink-0' : ''}
    />
  );

  const photos = counts.kinds.get('photo') ?? 0;
  const clips = counts.kinds.get('video') ?? 0;
  const heldCount = counts.total - counts.notHeld;
  const culled = counts.total ? Math.round((1 - counts.buckets.unrated / counts.total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={host.title}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="relative w-full max-w-[68rem] h-[min(calc(var(--app-h)*0.9),54rem)] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-5 overflow-hidden max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:p-3 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* --- the header: title, destination, scope, the one date control --- */}
        <div className="flex-none flex items-center gap-2 flex-wrap">
          <h2 className="m-0 font-serif text-2xl leading-tight min-w-0 truncate max-[820px]:text-xl max-[820px]:flex-1">
            {host.title}
          </h2>
          <span
            className="flex-none font-mono text-3xs tracking-[0.1em] uppercase px-2 py-0.5 rounded-full border border-line bg-paper-2 text-ink-soft"
            title="Where the ticked media go"
          >
            → {host.destination}
          </span>
          <span className="flex-1" />
          {/* On a phone the scope and the date take a line of their own, the
              close button staying up with the title. */}
          <div className="flex items-center gap-2 max-[820px]:order-last max-[820px]:w-full">
            <Segmented
              label="Browse by"
              size="sm"
              value={scope}
              onChange={(v) => setScope(v)}
              options={[
                { id: 'day', label: 'Day' },
                { id: 'span', label: 'Span', title: 'Several days as one list — a trip, a month' },
                { id: 'session', label: 'Folder' },
              ]}
            />
            <div className="w-[16rem] min-w-0 max-[820px]:flex-1 max-[820px]:w-auto">
              {scope === 'day' ? (
                <DayPicker
                  span={{ from: day, to: day }}
                  onDay={setDay}
                  anchor={host.anchor ?? null}
                  asking={asking}
                  count={rows?.length ?? null}
                  client={client}
                  connectionId={connection.id}
                  filter={half || mediaType ? { ...(half ? { half } : {}), ...(mediaType ? { mediaType } : {}) } : undefined}
                  showLine={false}
                />
              ) : scope === 'span' ? (
                <SpanPicker span={span} onSpan={setSpan} presets={presets} today={today} />
              ) : (
                <FolderPicker
                  sessions={sessions}
                  current={session}
                  onPick={(s) => setSessionId(s.id)}
                  openFirst={sessionId === null}
                />
              )}
            </div>
          </div>
          <IconButton label="Close" onClick={close}>
            {Icons.close}
          </IconButton>
        </div>

        {/* --- one line: what the scope holds, or why it holds nothing --- */}
        <p className="m-0 flex-none font-mono text-2xs text-muted tabular-nums">
          {scope === 'session' && sessionId === null
            ? 'choose a folder'
            : asking
              ? `asking ${connection.id}…`
              : counts.total === 0 && !problem
                ? `nothing here${host.accepts ? ' this host can take' : ''}`
                : `${counts.total} media${photos || !clips ? ` · ${photos} photo${photos === 1 ? '' : 's'}` : ''}${clips ? ` · ${clips} clip${clips === 1 ? '' : 's'}` : ''}${
                    piles.size ? ` · ${piles.size} burst${piles.size === 1 ? '' : 's'}` : ''
                  }${heldCount ? ` · ${heldCount} ${host.heldLabel}` : ''} · culled ${culled} %${
                    scope === 'span' ? ` · ${spanDays(span)} days` : ''
                  }`}
          {landing && (
            <span>
              {' '}
              {jumpDay ? (
                <b className="font-semibold text-accent-ink">
                  · loading {formatIsoDate(jumpDay).split(' ').slice(1).join(' ')} first ·{' '}
                  {spanDayList.filter((d) => d.date.slice(0, 7) === jumpDay.slice(0, 7)).reduce((n, d) => n + d.count, 0)} media
                </b>
              ) : null}
              {' '}· loading {rows!.length}
              {spanTotal !== null ? ` of about ${spanTotal}` : ''}…
            </span>
          )}
          {capped && !asking && (
            <span className="text-warn"> · the first {rows!.length} only — narrow the {scope === 'session' ? 'folder' : 'span'} to see the rest</span>
          )}
          {problem && (
            <span className="text-danger">
              {' '}
              · {problem.text}{' '}
              {problem.login && (
                <a href={problem.login} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Sign in
                </a>
              )}{' '}
              <button
                type="button"
                onClick={() => setGeneration((g) => g + 1)}
                className="p-0 border-0 bg-transparent text-danger underline underline-offset-2 cursor-pointer"
              >
                Try again
              </button>
            </span>
          )}
        </p>

        <div className="flex-1 min-h-0 flex gap-4">
          {/* --- the rail: a column on a desktop, a full sheet on a phone --- */}
          <aside
            aria-label="Filters"
            className={`w-60 shrink-0 overflow-y-auto overscroll-contain pr-3 border-r border-line max-[820px]:fixed max-[820px]:inset-0 max-[820px]:z-[60] max-[820px]:w-auto max-[820px]:bg-surface max-[820px]:p-4 max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))] max-[820px]:border-0 ${
              railOpen ? '' : 'max-[820px]:hidden'
            } ${railShown ? '' : 'min-[821px]:hidden'}`}
          >
            <PickerRail
              counts={railCounts}
              facets={facets}
              onFacets={setFacets}
              half={half}
              onHalf={setHalf}
              heldLabel={host.heldLabel}
              client={client}
              subject={subjectLists}
              describe={describe}
              onReach={setReach}
              footer={
                <div className="hidden max-[820px]:block sticky bottom-0 pt-2 bg-surface">
                  <Button variant="primary" size="lg" className="w-full" onClick={() => setRailOpen(false)}>
                    Show {shownItems.length} media
                  </Button>
                </div>
              }
            />
          </aside>

          {/* --- the grid --- */}
          <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
            <div className="flex-none flex items-center gap-2">
              {/* A wrapper carries the breakpoint: a Button's own
                  `inline-flex` outranks `hidden` in the generated sheet. */}
              <span className={railShown ? 'hidden max-[820px]:contents' : 'contents'}>
                <Button variant={active ? 'default' : 'ghost'} size="sm" icon={Icons.filter} onClick={openFilters}>
                  Filters{active ? ` · ${active}` : ''}
                </Button>
              </span>
              <span className="font-mono text-2xs text-muted tabular-nums min-w-0 truncate">
                {rankKey && describe.state === 'ready'
                  ? `${shownItems.length} shown · the closest to “${describing}”, any day`
                  : `${shownItems.length} shown of ${counts.total}`}
              </span>
              <span className="flex-1" />
              {counts.logs.with > 0 && (
                <Button
                  variant={tracksOn ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={tracksOn}
                  icon={Icons.map}
                  onClick={() => setTracksOn((on) => !on)}
                  title={
                    tracksOn
                      ? `Stop reading the flight logs (those read stay drawn)${
                          missed ? ` · ${missed} could not be read: ${connection.id} lists those clips but cannot hand over their .srt — usually a drive they were ingested from that is not plugged in` : ''
                        }`
                      : "Read the shown clips' flight logs — a small download each — and draw each flight's track"
                  }
                >
                  {tracksOn ? tracksLabel : 'Read tracks'}
                </Button>
              )}
<SettingsMenu
                label="The grid: view, order, tile size, filters"
                sections={[
                  {
                    kind: 'choice',
                    id: 'view',
                    label: 'View',
                    value: view,
                    onPick: (v) => pickView(readView(v)),
                    options: [
                      { id: 'grid', icon: Icons.grid, label: 'Grid of thumbnails' },
                      { id: 'book', icon: Icons.rows, label: 'Logbook — one line each, with the flight' },
                      { id: 'map', icon: Icons.map, label: 'Map — where each was taken; drag a box to tick what is inside' },
                    ],
                  },
                  {
                    kind: 'choice',
                    id: 'sort',
                    label: 'Order',
                    value: sort,
                    onPick: (v) => setSort(v === 'stars' ? 'stars' : 'time'),
                    options: [
                      { id: 'time', icon: Icons.clock, label: 'By capture time' },
                      { id: 'stars', icon: Icons.star, label: 'By stars, most first' },
                    ],
                  },
                  {
                    kind: 'choice',
                    id: 'tiles',
                    label: 'Tiles',
                    value: tiles,
                    onPick: (v) => setTiles(readTiles(v)),
                    options: [
                      { id: 's', icon: Icons.sizeS, label: 'Small tiles' },
                      { id: 'm', icon: Icons.sizeM, label: 'Medium tiles' },
                      { id: 'l', icon: Icons.sizeL, label: 'Large tiles' },
                    ],
                  },
                  ...(phone
                    ? []
                    : ([
                        {
                          kind: 'switch',
                          id: 'rail',
                          label: 'Filters',
                          text: railShown ? 'A column at the left' : 'Folded',
                          on: railShown,
                          onToggle: () => setRailShown(!railShown),
                        },
                      ] as const)),
                ]}
              />
            </div>
            {grouped && scope === 'span' && months.length > 1 && (
              <MonthStrip
                months={months}
                waiting={(month) => (virtual ? spanDayList.some((d) => d.date.startsWith(month) && !partDone(d.date)) : !loaded && landedThrough !== null && month > landedThrough.slice(0, 7))}
                pending={jumpDay ? jumpDay.slice(0, 7) : null}
                onJump={jumpTo}
              />
            )}
            {/* The verdict mix, drawn once: a hidden bucket is dimmed, never removed. */}
            {counts.total > 0 && (
              <div className="flex-none flex h-1.5 gap-0.5 rounded-full overflow-hidden bg-paper-2" aria-hidden="true">
                {BUCKETS.map((b) =>
                  counts.buckets[b] ? (
                    <span
                      key={b}
                      className={`${SWATCH[b]} ${facets.buckets.includes(b) ? '' : 'opacity-25'}`}
                      style={{ flex: counts.buckets[b] }}
                    />
                  ) : null,
                )}
              </div>
            )}
            <div ref={gridBox} className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${virtual ? '[overflow-anchor:none]' : ''}`}>
              {rankKey && describe.state === 'asking' ? (
                <LoadingState label={`Asking ${connection.id}’s image index for “${describing}”…`} />
              ) : rankKey && describe.state === 'off' ? (
                <p className="m-0 text-sm text-muted">
                  {connection.id} cannot rank by a description{describe.reason ? ` — ${describe.reason}` : ' — it keeps no image index'}. Switch the words to <i>In text</i> to look in the files’ names and the text read in them.
                </p>
              ) : rankKey && describe.state === 'empty' ? (
                <p className="m-0 text-sm text-muted">
                  Nothing on {connection.id} is indexed for search yet — its <i>Index for search</i> job reads each picture once. Switch the words to <i>In text</i> meanwhile.
                </p>
              ) : !rankKey && asking ? (
                <LoadingState label={`Asking ${connection.id}…`} />
              ) : !rankKey && scope === 'session' && sessionId === null ? (
                <p className="m-0 text-sm text-muted">Choose a folder above — its pictures are listed, nothing is downloaded until you add them.</p>
              ) : shownItems.length === 0 && !(virtual && !loaded) ? (
                <p className="m-0 text-sm text-muted">
                  {counts.total ? 'Nothing passes these filters. ' : rankKey ? `Nothing ranked for “${describing}”. ` : ''}
                  {counts.total > 0 && (
                    <button
                      type="button"
                      onClick={() => setFacets(SHOW_ALL)}
                      className="p-0 border-0 bg-transparent text-sm text-accent-ink underline underline-offset-2 cursor-pointer"
                    >
                      Show everything
                    </button>
                  )}
                </p>
              ) : (
                (() => {
                  if (view === 'map') {
                    return (
                      <PickerMap
                        items={shownItems}
                        ticked={ticked}
                        onTick={(ids, on) =>
                          setTicked((cur) => {
                            const next = new Set(cur);
                            for (const id of ids) {
                              if (on) next.add(id);
                              else next.delete(id);
                            }
                            return next;
                          })
                        }
                        onToggle={(id) => {
                          const it = shownItems.find((x) => x.id === id);
                          if (it && !it.held) {
                            setTicked((cur) => {
                              const next = new Set(cur);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            });
                            setAnchorId(id);
                            setFocusId(id);
                          }
                        }}
                        fitKey={rankKey ? `describe|${rankKey}` : scopeKey}
                        heldLabel={host.heldLabel}
                        loaded={loaded}
                      />
                    );
                  }
                  const more = limit < shownItems.length && (
                    <MoreTiles key={limit} as={view === 'book' ? 'div' : 'li'} onVisible={() => setLimit((n) => n + BATCH)} />
                  );
                  // Rows pinned in pixels: an `auto` row in a scrolling tile
                  // grid is clipped to a sliver (`frontend.md`). The padding is
                  // the focused tile's ring (2 px out, 2 px wide): without it the
                  // scroller clips the ring on the grid's outer edges.
                  const grid = `m-0 p-1 list-none grid gap-2 max-[820px]:gap-1.5 ${TILE_GRID[tiles]}`;
                  const cells = (list: PickItem[]) =>
                    list.map((it) => {
                      const pile = it.pileId === null ? undefined : piles.get(it.pileId);
                      const row = pile && pile.coverId === it.id && unfolded.has(pile.id) ? framesUnder(items, pile) : null;
                      return (
                        <Fragment key={it.id}>
                          {tile(it)}
                          {row && (
                            <li className="col-span-full row-span-1 min-w-0 rounded-paper border border-dashed border-line-strong bg-paper-2">
                              {/* The padding is the focused frame's ring (2 px out, 2 px wide) and a little air. */}
                              <ul className="m-0 px-2 py-1.5 list-none flex gap-2 overflow-x-auto overflow-y-hidden h-full items-center">
                                {row.length ? (
                                  row.map((f) => tile(f, true))
                                ) : (
                                  <li className="font-mono text-2xs text-muted px-2">
                                    {pileAsking.has(pile!.id)
                                      ? `asking ${connection.id} for the burst's frames…`
                                      : `${pile!.size - 1} more frame${pile!.size === 2 ? '' : 's'} on ${connection.id}, not listed here`}
                                  </li>
                                )}
                              </ul>
                            </li>
                          )}
                        </Fragment>
                      );
                    });
                  if (virtual) {
                    // Every counted day, at its real height: tiles near the view, a spacer
                    // (grey while its part is on its way) everywhere else.
                    return (
                      <>
                        <ul ref={measureRef} aria-hidden="true" className={`${grid} invisible h-0 overflow-hidden !py-0`} />
                        {spanDayList.map((d) => {
                          const done = partDone(d.date);
                          const its = byDay.get(d.date) ?? [];
                          const n = done ? its.length : d.count;
                          const near = nearDays.has(d.date);
                          // A day the filters empty is HIDDEN, never unmounted: the sections are
                          // observed once, and a part's state lands a render before its rows.
                          return (
                            <section key={d.date} data-span-day={d.date} aria-label={dayHeading(d.date)} className="mb-3" hidden={done && n === 0}>
                              <h3 data-day={d.date} className="sticky top-0 z-[2] m-0 px-1 py-1.5 bg-surface flex items-baseline gap-2 text-xs font-semibold">
                                {dayHeading(d.date)}
                                <span className="font-mono text-3xs font-normal text-muted tabular-nums">
                                  {n} media{done ? '' : jumpDay === d.date ? ' · loading first' : ' · on its way'}
                                </span>
                              </h3>
                              {done && near ? (
                                <ul className={grid}>{cells(its)}</ul>
                              ) : (
                                <div
                                  aria-hidden="true"
                                  className={done ? '' : 'rounded-paper bg-paper-2 animate-pulse motion-reduce:animate-none'}
                                  style={{ height: blockHeight(n) }}
                                />
                              )}
                            </section>
                          );
                        })}
                      </>
                    );
                  }
                  const batch = shownItems.slice(0, limit);
                  if (view === 'book') {
                    return (
                      <PickerLogbook
                        items={batch}
                        grouped={grouped}
                        client={client}
                        ticked={ticked}
                        focusId={focusId}
                        heldLabel={host.heldLabel}
                        tracks={tracksOn ? tracks : new Map()}
                        missing={tracksOn ? missing : new Map()}
                        reading={tracksOn}
                        onToggle={toggle}
                        onLook={look}
                        more={more}
                      />
                    );
                  }
                  if (!grouped) {
                    return (
                      <ul className={grid}>
                        {cells(batch)}
                        {more}
                      </ul>
                    );
                  }
                  const runs = dayRuns(batch, (it) => rowDay(it.row));
                  return runs.map((run, k) => (
                    <section key={`${run.day ?? 'undated'}-${k}`} aria-label={run.day ? dayHeading(run.day) : 'Undated'} className="mb-3">
                      <h3 data-day={run.day ?? undefined} className="sticky top-0 z-[2] m-0 px-1 py-1.5 bg-surface flex items-baseline gap-2 text-xs font-semibold">
                        {run.day ? dayHeading(run.day) : 'No date'}
                        <span className="font-mono text-3xs font-normal text-muted tabular-nums">{run.items.length} media</span>
                      </h3>
                      <ul className={grid}>
                        {cells(run.items)}
                        {k === runs.length - 1 && more}
                      </ul>
                    </section>
                  ));
                })()
              )}
            </div>
          </div>
        </div>

        {/* --- the bar: ticks first, then the host's verbs --- */}
        <div className="flex-none flex items-center gap-1.5 flex-wrap border-t border-line pt-3">
          <span className="inline-flex items-baseline gap-1.5 pr-1" aria-live="polite">
            <b className="font-mono text-lg font-medium text-accent-ink tabular-nums">{tickedRows.length}</b>
            <span className="text-xs text-muted">ticked</span>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setFacets(SHOW_ALL)}
                title="Ticked but hidden by a filter — they will be added. Show everything."
                className="p-0 border-0 bg-transparent font-mono text-2xs text-warn underline underline-offset-2 cursor-pointer"
              >
                · {hidden} hidden
              </button>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setTicked((cur) => withAll(cur, drawnItems))} title="Tick everything shown (A)">
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTicked((cur) => withNoneShown(cur, drawnItems))} title="Untick everything shown (N)">
            None
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTicked((cur) => inverted(cur, drawnItems))} title="Invert what is shown (I)">
            Invert
          </Button>
          <span className="w-px self-stretch bg-line mx-1 max-[820px]:hidden" aria-hidden="true" />
          <span className="inline-flex items-center gap-1" role="group" aria-label="Tick by Winnow's word, among what is shown">
            <Button variant="default" size="sm" onClick={(e) => tickBy('picks', e.shiftKey)} title="Tick the picks shown (P) — ⇧ adds them to the ticks">
              <span className="text-ok">⚑</span> Picks
            </Button>
            <Button variant="default" size="sm" onClick={(e) => tickBy('stars5', e.shiftKey)} title="Tick the ★5 shown (5) — ⇧ adds">
              ★5
            </Button>
            <Button variant="default" size="sm" onClick={(e) => tickBy('stars4', e.shiftKey)} title="Tick ★4 and up shown (4) — ⇧ adds">
              ★4+
            </Button>
          </span>
          {say && <span className="font-mono text-2xs text-muted px-1 max-[820px]:hidden">{say}</span>}
          <span className="flex-1" />
          {host.extras?.(tickedRows)}
          {progress && <span className="font-mono text-2xs text-muted max-[820px]:w-full">{progress}</span>}
          <span className="contents max-[820px]:hidden">
            <Button variant="ghost" onClick={close}>
              {running ? 'Stop' : 'Cancel'}
            </Button>
          </span>
          {host.actions.map((action, i) => {
            const last = i === host.actions.length - 1;
            return (
              <Button
                key={action.key}
                variant={last ? 'primary' : 'default'}
                icon={last ? Icons.plus : undefined}
                disabled={!can(action) || running !== null}
                onClick={() => void run(action)}
                className={last ? 'max-[820px]:flex-1 max-[820px]:basis-full' : ''}
              >
                {action.label(tickedRows.length, tickedRows)}
              </Button>
            );
          })}
        </div>
      </div>
      {peek !== null && drawnItems[peek] && (
        <MediaLightbox
          items={lookItems}
          index={peek}
          onIndex={(i) => {
            setPeek(i);
            setFocusId(drawnItems[i]?.id ?? null);
          }}
          onClose={() => setPeek(null)}
          from={`from ${connection.id}`}
          heal={(url) => client.heal(url)}
          onConfirm={() => {
            const it = drawnItems[peek];
            if (it && !it.held) setTicked((cur) => {
              const next = new Set(cur);
              if (next.has(it.id)) next.delete(it.id);
              else next.add(it.id);
              return next;
            });
          }}
          footer={(() => {
            const it = drawnItems[peek];
            const on = ticked.has(it.id);
            return (
              <div className="flex items-center gap-3 flex-wrap">
                {it.held ? (
                  <span className="font-mono text-2xs uppercase tracking-[0.1em] text-muted">{host.heldLabel}</span>
                ) : (
                  <Button
                    variant={on ? 'default' : 'primary'}
                    icon={on ? undefined : Icons.check}
                    onClick={() =>
                      setTicked((cur) => {
                        const next = new Set(cur);
                        if (next.has(it.id)) next.delete(it.id);
                        else next.add(it.id);
                        return next;
                      })
                    }
                  >
                    {on ? 'Untick' : 'Tick'}
                  </Button>
                )}
                <span className="text-xs text-muted">{tickedRows.length} ticked · Enter ticks, Escape goes back to the grid</span>
              </div>
            );
          })()}
        />
      )}
    </div>
  );
}

/** The end of the grid: once it nears the viewport, one more batch is mounted. */
function MoreTiles({ onVisible, as = 'li' }: { onVisible: () => void; as?: 'li' | 'div' }) {
  const [ref, inView] = useInViewport<HTMLElement>();
  const fired = useRef(false);
  useEffect(() => {
    if (!inView || fired.current) return;
    fired.current = true;
    onVisible();
  }, [inView, onVisible]);
  return as === 'li' ? (
    <li ref={ref as Ref<HTMLLIElement>} className="col-span-full h-px" aria-hidden />
  ) : (
    <div ref={ref as Ref<HTMLDivElement>} className="h-px" aria-hidden />
  );
}

/**
 * The folder half of the one date control: the current folder's name, and
 * the instance's folders in a popover under it — a session as Winnow
 * ingested it, under the same half as the grid.
 */
function FolderPicker({
  sessions,
  current,
  onPick,
  openFirst,
}: {
  sessions: WinnowSession[] | null;
  current: WinnowSession | null;
  onPick: (s: WinnowSession) => void;
  /** Open on arrival when no folder is chosen yet. */
  openFirst: boolean;
}) {
  const [open, setOpen] = useState(openFirst);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Claimed, so the picker closes the list and not itself.
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const span = (s: WinnowSession) => {
    const a = s.captured_at_min?.slice(0, 10);
    const b = s.captured_at_max?.slice(0, 10);
    return a && b && a !== b ? `${a} → ${b}` : (a ?? b ?? '—');
  };
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full h-8 flex items-center gap-1.5 px-2.5 rounded-paper border border-line bg-paper text-left text-sm cursor-pointer hover:bg-paper-2"
      >
        <span className="text-muted [&_svg]:w-3.5 [&_svg]:h-3.5">{Icons.folder}</span>
        <span className="flex-1 min-w-0 truncate">{current?.name ?? 'Choose a folder'}</span>
        <span className="text-3xs text-faint" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pick a folder"
          className="absolute right-0 top-9 z-20 w-[22rem] max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto flex flex-col gap-1 rounded-paper border border-line-strong bg-surface p-2 shadow-paper"
        >
          {sessions === null ? (
            <p className="m-0 p-2 font-mono text-2xs text-muted">asking…</p>
          ) : sessions.length === 0 ? (
            <p className="m-0 p-2 text-xs text-muted">No folder in this half of the library.</p>
          ) : (
            sessions.map((s) => {
              const on = current?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  title={s.source_path}
                  onClick={() => {
                    onPick(s);
                    setOpen(false);
                  }}
                  className={`text-left px-3 py-2 rounded-paper border cursor-pointer ${
                    on ? 'bg-ink text-paper border-ink' : 'bg-paper border-line hover:border-line-strong'
                  }`}
                >
                  <span className="block text-xs font-medium truncate">{s.name}</span>
                  <span className={`block font-mono text-3xs tabular-nums ${on ? 'opacity-70' : 'text-muted'}`}>
                    {span(s)} · {s.asset_count} media{s.device_hint ? ` · ${s.device_hint}` : ''}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A long span's months as one strip of bars, the height of each its share of
 * what the calendar counted: the year at a glance, and a jump to any month.
 * A month whose rows have not landed yet is drawn faint.
 */
function MonthStrip({
  months,
  waiting: isWaiting,
  pending,
  onJump,
}: {
  months: readonly { month: string; count: number }[];
  /** Whether a month's rows are still on their way. */
  waiting: (month: string) => boolean;
  /** The month a click went to, while its rows come — ringed and spinning, so the click shows it was heard. */
  pending: string | null;
  onJump: (month: string) => void;
}) {
  const max = Math.max(1, ...months.map((m) => m.count));
  const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="flex-none flex items-end gap-0.5" role="group" aria-label="Jump to a month of the span">
      {months.map((m) => {
        const name = NAMES[Number(m.month.slice(5, 7)) - 1];
        const waiting = isWaiting(m.month);
        const asked = pending === m.month;
        return (
          <button
            key={m.month}
            type="button"
            disabled={m.count === 0}
            onClick={() => onJump(m.month)}
            title={`${name} ${m.month.slice(0, 4)} · ${m.count} media${asked ? ' · loading first' : waiting ? ' · still loading' : ''}`}
            aria-busy={asked || undefined}
            className="flex-1 min-w-0 flex flex-col items-stretch gap-0.5 p-0 border-0 bg-transparent cursor-pointer disabled:cursor-default group"
          >
            <span className={`relative h-6 flex items-end ${asked ? 'outline outline-2 outline-accent outline-offset-1 rounded-[2px]' : ''}`}>
              {asked ? (
                <span className="absolute left-1/2 top-0.5 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 border-accent border-r-transparent animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
              <span
                className={`w-full rounded-t-[2px] ${m.count ? 'bg-accent group-hover:bg-accent-ink' : 'bg-line'} ${waiting && !asked ? 'opacity-35' : ''}`}
                style={{ height: `${m.count ? Math.max(12, (m.count / max) * 100) : 6}%` }}
              />
            </span>
            <span className="font-mono text-3xs text-muted truncate text-center">
              {name === 'Jan' || m === months[0] ? `${name} ${m.month.slice(2, 4)}` : name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
