import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { WinnowError, type LibraryHalf, type WinnowAssetRow, type WinnowClient, type WinnowSession } from '../client';
import type { WinnowConnection } from '../store';
import { readBrowseState, writeBrowseState } from '../browse-state';
import DayPicker from '../DayPicker';
import Button from '../../../ui/Button';
import IconButton from '../../../ui/IconButton';
import Segmented from '../../../ui/Segmented';
import LoadingState from '../../../ui/LoadingState';
import { Icons } from '../../../ui/icons';
import useDialogKeys from '../../../ui/use-dialog-keys';
import { useInViewport } from '../../../lib/use-in-viewport';
import PickerRail from './PickerRail';
import PickerTile, { type PileBadge } from './PickerTile';
import {
  activeFacets,
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
/** Tiles mounted per batch, the next as the end of the grid nears. */
const BATCH = 240;

type Scope = 'day' | 'session';

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
 *   (bars or weeks, `DayPicker`), or a folder (a Winnow session), picked from
 *   a list under the same control. The library half narrows the scope on the
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
  // Always opens on the host's day: the host knows what the person is looking
  // at. The folder, the half (unless the host names one) and the rail come
  // back from the last sitting on this instance.
  const [scope, setScope] = useState<Scope>('day');
  const [day, setDay] = useState(host.start.day);
  const [half, setHalf] = useState<LibraryHalf | null>(() =>
    host.start.half !== undefined ? host.start.half : (remembered?.filter.half ?? null),
  );
  const [sessionId, setSessionId] = useState<number | null>(remembered?.sessionId ?? null);
  const [facets, setFacets] = useState<PickFacets>(remembered?.facets ?? DEFAULT_FACETS);
  const [sort, setSort] = useState<PickSort>(remembered?.sort ?? 'time');

  const [rows, setRows] = useState<WinnowAssetRow[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [generation, setGeneration] = useState(0);

  // The scope's rows, every page. A change of scope forgets the last answer
  // first, so a new day never shows the previous one's pictures for a frame.
  useEffect(() => {
    setRows(null);
    setProblem(null);
    if (scope === 'session' && sessionId === null) return;
    const controller = new AbortController();
    let cancelled = false;
    const narrowing = half ? { half } : {};
    const ask =
      scope === 'day'
        ? client.allAssets({ dateFrom: day, dateTo: day, ...narrowing }, DAY_CAP, controller.signal)
        : client.allAssets({ sessionId: sessionId!, ...narrowing }, FOLDER_CAP, controller.signal);
    ask
      .then((all) => {
        if (!cancelled) setRows(all);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setProblem(explain(err, client, connection.id));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, connection.id, scope, day, sessionId, half, generation]);

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
      fidelity: stored?.fidelity ?? 'proxy',
      facets,
      sort,
    });
  }, [connection.id, scope, day, half, sessionId, facets, sort]);

  // --- what the grid holds ---------------------------------------------------
  const items = useMemo<PickItem[]>(
    () => (rows ?? []).filter((r) => !host.accepts || host.accepts(r)).map((r) => pickItem(r, host.held(r))),
    [rows, host],
  );
  const piles = useMemo(() => pilesOf(items), [items]);
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  const surfacedItems = useMemo(() => surfaced(items, piles, unfolded), [items, piles, unfolded]);
  // Counted with every pile folded, so unfolding one never moves a number.
  const counts = useMemo(() => facetCounts(surfaced(items, piles, new Set())), [items, piles]);
  const shownItems = useMemo(() => shown(surfacedItems, facets, sort), [surfacedItems, facets, sort]);
  const drawnItems = useMemo(() => drawn(shownItems, items, piles, unfolded), [shownItems, items, piles, unfolded]);

  // --- ticks -----------------------------------------------------------------
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  // Re-seeded when a scope's rows ARRIVE, never on a facet or a tick: the
  // opening rule describes a scope, not a view of it.
  const latest = useRef({ host, piles });
  latest.current = { host, piles };
  useEffect(() => {
    setUnfolded(new Set());
    setAnchorId(null);
    setFocusId(null);
    if (!rows) {
      setTicked(new Set());
      return;
    }
    const { host: h } = latest.current;
    const list = rows.filter((r) => !h.accepts || h.accepts(r)).map((r) => pickItem(r, h.held(r)));
    setTicked(openingTicks(h.openTicks, surfaced(list, pilesOf(list), new Set())));
  }, [rows]);

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

  const run = async (action: PickerAction) => {
    if (!tickedRows.length || running) return;
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

  useDialogKeys({
    onCancel: close,
    onConfirm: primary && tickedRows.length && !running ? () => void run(primary) : null,
  });

  // The grid's own keys: the bulk verbs, Winnow-style. A field keeps its keys,
  // and a press another surface claimed (a popover) is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
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
  }, [tickBy, drawnItems]);

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
  useEffect(() => setLimit(BATCH), [rows, facets, sort]);

  const [railOpen, setRailOpen] = useState(false);
  const active = activeFacets(facets);
  const session = sessions?.find((s) => s.id === sessionId) ?? null;
  const asking = rows === null && problem === null && !(scope === 'session' && sessionId === null);

  const pileBadge = (it: PickItem, inRow: boolean): PileBadge | null => {
    if (it.pileId === null) return null;
    const pile = piles.get(it.pileId);
    if (!pile) return null;
    const open = unfolded.has(pile.id);
    const flip = () =>
      setUnfolded((cur) => {
        const next = new Set(cur);
        if (next.has(pile.id)) next.delete(pile.id);
        else next.add(pile.id);
        return next;
      });
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
      onLook={() => setFocusId(it.id)}
      className={inRow ? 'w-32 h-24 shrink-0' : ''}
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
      <div className="relative w-full max-w-[68rem] h-[min(90dvh,54rem)] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-5 overflow-hidden max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:p-3 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
                  filter={half ? { half } : undefined}
                  showLine={false}
                />
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
                : `${counts.total} media · ${photos} photo${photos === 1 ? '' : 's'}${clips ? ` · ${clips} clip${clips === 1 ? '' : 's'}` : ''}${
                    piles.size ? ` · ${piles.size} burst${piles.size === 1 ? '' : 's'}` : ''
                  }${heldCount ? ` · ${heldCount} ${host.heldLabel}` : ''} · culled ${culled} %`}
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
            }`}
          >
            <PickerRail
              counts={counts}
              facets={facets}
              onFacets={setFacets}
              half={half}
              onHalf={setHalf}
              heldLabel={host.heldLabel}
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
              <span className="hidden max-[820px]:contents">
                <Button variant={active ? 'default' : 'ghost'} size="sm" onClick={() => setRailOpen(true)}>
                  Filters{active ? ` · ${active}` : ''}
                </Button>
              </span>
              <span className="font-mono text-2xs text-muted tabular-nums">
                {shownItems.length} shown of {counts.total}
              </span>
              <span className="flex-1" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value === 'stars' ? 'stars' : 'time')}
                aria-label="Sort"
                className="font-sans text-xs px-2.5 py-1 border border-line rounded-full bg-paper text-ink focus:outline-none focus:border-accent max-[820px]:text-base"
              >
                <option value="time">Capture time</option>
                <option value="stars">Stars</option>
              </select>
            </div>
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
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {asking ? (
                <LoadingState label={`Asking ${connection.id}…`} />
              ) : scope === 'session' && sessionId === null ? (
                <p className="m-0 text-sm text-muted">Choose a folder above — its pictures are listed, nothing is downloaded until you add them.</p>
              ) : shownItems.length === 0 ? (
                <p className="m-0 text-sm text-muted">
                  {counts.total ? 'Nothing passes these filters. ' : ''}
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
                // Rows pinned in pixels: an `auto` row in a scrolling tile
                // grid is clipped to a sliver (`frontend.md`).
                <ul className="m-0 p-0 list-none grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] auto-rows-[6rem] gap-2 max-[820px]:grid-cols-3 max-[820px]:auto-rows-[5.6rem] max-[820px]:gap-1.5">
                  {shownItems.slice(0, limit).map((it) => {
                    const pile = it.pileId === null ? undefined : piles.get(it.pileId);
                    const row = pile && pile.coverId === it.id && unfolded.has(pile.id) ? framesUnder(items, pile) : null;
                    return (
                      <Fragment key={it.id}>
                        {tile(it)}
                        {row && (
                          <li className="col-span-full row-span-1 min-w-0 rounded-paper border border-dashed border-line-strong bg-paper-2">
                            <ul className="m-0 p-2 list-none flex gap-2 overflow-x-auto h-full items-center">
                              {row.length ? row.map((f) => tile(f, true)) : (
                                <li className="font-mono text-2xs text-muted px-2">
                                  {pile!.size - 1} more frame{pile!.size === 2 ? '' : 's'} on {connection.id}, not listed here
                                </li>
                              )}
                            </ul>
                          </li>
                        )}
                      </Fragment>
                    );
                  })}
                  {limit < shownItems.length && (
                    <MoreTiles key={limit} onVisible={() => setLimit((n) => n + BATCH)} />
                  )}
                </ul>
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
                disabled={!tickedRows.length || running !== null}
                onClick={() => void run(action)}
                className={last ? 'max-[820px]:flex-1 max-[820px]:basis-full' : ''}
              >
                {action.label(tickedRows.length)}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The end of the grid: once it nears the viewport, one more batch is mounted. */
function MoreTiles({ onVisible }: { onVisible: () => void }) {
  const [ref, inView] = useInViewport<HTMLLIElement>();
  const fired = useRef(false);
  useEffect(() => {
    if (!inView || fired.current) return;
    fired.current = true;
    onVisible();
  }, [inView, onVisible]);
  return <li ref={ref} className="col-span-full h-px" aria-hidden />;
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
