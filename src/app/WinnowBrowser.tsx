import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from './use-hash-route';
import {
  WinnowClient,
  WinnowError,
  hasTimeline,
  type FilterQuery,
  type WinnowAssetRow,
  type WinnowCalendar,
  type WinnowChapter,
  type WinnowFacets,
  type WinnowSession,
} from '../shared/sources/winnow/client';
import { PLACE_ARROW } from '../shared/roadtrip/trip-places';
import { materialize, type Fidelity } from '../shared/sources/winnow/materialize';
import {
  monthKeyOf,
  monthLabel,
  monthOptions,
  monthSpan,
  shiftMonth,
} from '../shared/sources/winnow/month';
import { type WinnowConnection } from '../shared/sources/winnow/store';
import {
  readBrowseState,
  writeBrowseState,
  type BrowseView,
} from '../shared/sources/winnow/browse-state';
import { formatBytes } from '../shared/lib/format';

/** How many times a thumbnail is asked for again before the tile gives up. */
const THUMB_RETRIES = 3;

/**
 * One tile's thumbnail, which retries instead of staying black.
 *
 * A grid of a busy day fires a hundred-odd image requests at once, down a
 * tunnel to a home server. Some lose: a dropped connection, a request shed
 * under load, a cache entry poisoned by a response that arrived without its
 * CORS headers. An `<img>` has no answer to any of that — it fires `error`
 * once and the tile is a black rectangle for the rest of the session, which is
 * exactly what was seen on a day of 132.
 *
 * So: retry with a widening delay (the failures are load-shaped, and hammering
 * makes them worse), then say plainly that the picture would not come. The
 * first attempt uses the plain URL so the ordinary path stays as cacheable as
 * Winnow means it to be — only retries carry a discriminator.
 */
function Thumb({
  src,
  attempt,
  onFailed,
  label,
}: {
  src: string;
  attempt: number;
  onFailed: () => void;
  label: string;
}) {
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => setGaveUp(false), [src]);

  if (gaveUp || attempt > THUMB_RETRIES) {
    return (
      <div className="w-full h-[90px] max-[820px]:h-[120px] grid place-items-center bg-frame">
        <span className="font-mono text-[0.55rem] uppercase tracking-wide text-[#8a8270]">
          {label}
        </span>
      </div>
    );
  }
  return (
    <img
      // `key` on the attempt: React must build a NEW element, or swapping the
      // src on the failed one can be ignored by the browser.
      key={attempt}
      src={src}
      crossOrigin="use-credentials"
      alt=""
      className="block w-full h-[90px] max-[820px]:h-[120px] object-cover"
      loading="lazy"
      decoding="async"
      onError={() => {
        if (attempt >= THUMB_RETRIES) setGaveUp(true);
        else onFailed();
      }}
    />
  );
}

interface WinnowBrowserProps {
  connection: WinnowConnection;
  onAdd: (files: File[]) => void;
  onClose: () => void;
}

/**
 * How the library is walked: by the day it was shot, by the folder it was
 * ingested from, or by the leg of the journey the timeline grouped it into.
 */
type View = BrowseView;

/** What a chapter is called in the list: its title, else its route, else its id. */
export function chapterLabel(chapter: WinnowChapter): string {
  const title = chapter.title?.trim();
  if (title) return title;
  const names = chapter.places.map((p) => p.name.trim()).filter(Boolean);
  if (!names.length) return `chapter ${chapter.id}`;
  const first = names[0];
  const last = names[names.length - 1];
  return first === last ? first : `${first} ${PLACE_ARROW} ${last}`;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
// Under 820px every control grows: a finger is not a cursor, and a control
// whose font is under 16px makes iOS zoom the page the moment it is tapped.
const pill =
  'px-3 py-1 inline-flex items-center border rounded-full cursor-pointer text-[0.78rem] transition-colors max-[820px]:px-3.5 max-[820px]:py-1.5 max-[820px]:text-[0.85rem]';
const select =
  'font-sans text-[0.78rem] px-2.5 py-1 border border-line rounded-full bg-paper text-ink focus:outline-none focus:border-accent max-w-[14rem] min-w-0 max-[820px]:text-[1rem] max-[820px]:py-1.5 max-[820px]:max-w-full';
/** A filter select shares the row evenly once that row starts wrapping. */
const filterSelect = `${select} max-[820px]:flex-1 max-[820px]:basis-[10rem]`;

/** One line a person can act on, for whatever the client threw. */
function explain(err: unknown, client: WinnowClient): { text: string; login?: string } {
  if (err instanceof WinnowError && err.kind === 'unauthenticated') {
    return { text: `Not signed in to ${client.config.baseUrl}.`, login: client.loginUrl() };
  }
  return { text: err instanceof Error ? err.message : String(err) };
}

function shortDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

/**
 * Browse a connected Winnow and pull pictures into the library.
 *
 * Three ways in. **By day**, because Road Trip is day-keyed — "everything from
 * 9 July" is the question the grid asks, and `/api/assets/calendar` answers it
 * with a count and a cover per day. **By session**, because a Winnow session
 * is one shoot folder as it was ingested — what a photographer means by "that
 * folder". **By leg**, when the instance serves its timeline: a chapter is the
 * unit a piece is actually cut from ("the three days at Kalbarri"), one click
 * instead of three days picked across a month boundary. One row of filters
 * (type, extension, device) narrows all three, and the counts agree: Winnow
 * applies the same filters everywhere. A chapter is a prefilled LIST, never an
 * automatic download — ticking is still the user's.
 *
 * What lands in the library is a fetched FILE (see `materialize.ts`): the
 * proxy by default — fast, and the codec shape the pipeline wants — or the
 * original on request, with its weight shown so the cost is a choice.
 */
export default function WinnowBrowser({ connection, onAdd, onClose }: WinnowBrowserProps) {
  const client = useMemo(
    () => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }),
    [connection.baseUrl, connection.auth],
  );

  // Where this instance was left last time. Picking a trip's media happens
  // over several sittings, so the modal reopens where it closed.
  const remembered = useMemo(() => readBrowseState(connection.id), [connection.id]);
  // Said by the instance at connect time; an older Winnow has no timeline and
  // the tab says so instead of asking for a route that is not there.
  const timelineOffered = hasTimeline(connection.capabilities);

  const [view, setView] = useState<View>(() => {
    const wanted = remembered?.view ?? 'day';
    return wanted === 'chapter' && !timelineOffered ? 'day' : wanted;
  });
  const [filter, setFilter] = useState<FilterQuery>(remembered?.filter ?? {});
  const [facets, setFacets] = useState<WinnowFacets | null>(null);

  const [month, setMonth] = useState<string>(
    () => remembered?.month ?? monthKeyOf(new Date().toISOString()),
  );
  const [calendar, setCalendar] = useState<WinnowCalendar | null>(null);
  const [day, setDay] = useState<string | null>(remembered?.day ?? null);

  const [sessions, setSessions] = useState<WinnowSession[] | null>(null);
  const [session, setSession] = useState<WinnowSession | null>(null);
  /** The folder to re-open once the list arrives; cleared after it is found. */
  const [wantedSessionId, setWantedSessionId] = useState<number | null>(
    remembered?.sessionId ?? null,
  );

  const [chapters, setChapters] = useState<WinnowChapter[] | null>(null);
  const [chapter, setChapter] = useState<WinnowChapter | null>(null);
  // The open leg's id, readable from the timeline effect without making it a
  // dependency: re-fetching the timeline on every pick would loop, since the
  // pick is then re-pointed at the fresh list's object.
  const chapterIdRef = useRef<string | null>(null);
  chapterIdRef.current = chapter?.id ?? null;
  /** The leg to re-open once the timeline arrives; cleared after it is found. */
  const [wantedChapterId, setWantedChapterId] = useState<string | null>(
    remembered?.chapterId ?? null,
  );

  const [rows, setRows] = useState<WinnowAssetRow[] | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set());
  const [fidelity, setFidelity] = useState<Fidelity>(remembered?.fidelity ?? 'proxy');
  const [problem, setProblem] = useState<{ text: string; login?: string } | null>(null);
  /** Per-asset retry count for a thumbnail that failed to load. */
  const [thumbAttempt, setThumbAttempt] = useState<ReadonlyMap<number, number>>(
    () => new Map(),
  );
  const [progress, setProgress] = useState<string | null>(null);
  const [landed, setLanded] = useState(() => remembered !== null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Under 820px this is a full-screen sheet, and a page still scrolling
    // behind it drags the whole screen while a grid of tiles is swiped.
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = bodyOverflow;
    };
  }, [onClose]);

  // The filter values, once: the pickers offer what the library actually holds.
  useEffect(() => {
    let cancelled = false;
    client
      .facets()
      .then((f) => {
        if (!cancelled) setFacets(f);
      })
      .catch(() => {
        /* the pickers just stay empty — filtering is a convenience */
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // The month's calendar, under the current filters. On first answer, jump
  // to the newest month that has media — a fresh view opening on an empty
  // month reads as a broken source.
  useEffect(() => {
    if (view !== 'day') return;
    let cancelled = false;
    const span = monthSpan(month);
    setCalendar(null);
    setProblem(null);
    client
      .calendar(span.from, span.to, filter)
      .then((cal) => {
        if (cancelled) return;
        if (!landed) {
          setLanded(true);
          if (cal.bounds && !cal.days.length) {
            setMonth(monthKeyOf(cal.bounds.max));
            return;
          }
        }
        setCalendar(cal);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      });
    return () => {
      cancelled = true;
    };
  }, [client, view, month, filter, landed]);

  // The sessions, under the current filters — a session stays listed while at
  // least one of its assets matches.
  useEffect(() => {
    if (view !== 'session') return;
    let cancelled = false;
    setSessions(null);
    setProblem(null);
    client
      .sessions(filter)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        if (wantedSessionId !== null) {
          setSession(list.find((s) => s.id === wantedSessionId) ?? null);
          setWantedSessionId(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      });
    return () => {
      cancelled = true;
    };
  }, [client, view, filter]);

  // The timeline's chapters, under the current filters — the same narrowing,
  // so a leg's count agrees with what its days would list.
  useEffect(() => {
    if (view !== 'chapter' || !timelineOffered) return;
    let cancelled = false;
    setChapters(null);
    setProblem(null);
    client
      .timeline(filter)
      .then((list) => {
        if (cancelled) return;
        setChapters(list);
        if (wantedChapterId !== null) {
          setChapter(list.find((c) => c.id === wantedChapterId) ?? null);
          setWantedChapterId(null);
        } else if (chapterIdRef.current !== null) {
          // Re-point at the same leg under the new filters, or let it go.
          setChapter(list.find((c) => c.id === chapterIdRef.current) ?? null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      });
    return () => {
      cancelled = true;
    };
  }, [client, view, filter, timelineOffered, wantedChapterId]);

  // The rows of whatever is chosen — a day, a session or a leg — oldest
  // first, every page. A filter change re-reads them under the new narrowing.
  const chosenDay = view === 'day' ? day : null;
  const chosenSession = view === 'session' ? session : null;
  const chosenChapter = view === 'chapter' ? chapter : null;
  useEffect(() => {
    if (!chosenDay && !chosenSession && !chosenChapter) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setRows(null);
    setChecked(new Set());
    // A new day is a new set of tiles: last day's failures must not silence them.
    setThumbAttempt(new Map());
    const query = chosenDay
      ? { dateFrom: chosenDay, dateTo: chosenDay, ...filter }
      : chosenChapter
        ? { chapterId: chosenChapter.id, ...filter }
        : { sessionId: chosenSession?.id, ...filter };
    client
      .allAssets(query)
      .then((all) => {
        if (!cancelled) setRows(all);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      });
    return () => {
      cancelled = true;
    };
  }, [client, chosenDay, chosenSession, chosenChapter, filter]);

  useEffect(() => {
    writeBrowseState(connection.id, {
      view,
      filter,
      month,
      day,
      sessionId: session?.id ?? wantedSessionId,
      chapterId: chapter?.id ?? wantedChapterId,
      fidelity,
    });
  }, [
    connection.id,
    view,
    filter,
    month,
    day,
    session,
    wantedSessionId,
    chapter,
    wantedChapterId,
    fidelity,
  ]);

  const span = monthSpan(month);
  const counts = new Map((calendar?.days ?? []).map((d) => [d.date, d.count]));
  const bounds = calendar?.bounds ?? null;
  const canPrev = !bounds || month > monthKeyOf(bounds.min);
  const canNext = !bounds || month < monthKeyOf(bounds.max);
  // The picker spans what the library holds; the month in view is always
  // offered even when the filters have emptied it, so the select never shows
  // a value it does not list.
  const years = useMemo(() => {
    const min = bounds ? (bounds.min < `${month}-01` ? bounds.min : `${month}-01`) : `${month}-01`;
    const max = bounds ? (bounds.max > span.to ? bounds.max : span.to) : span.to;
    return monthOptions(min, max);
  }, [bounds, month, span.to]);

  const picked = (rows ?? []).filter((r) => checked.has(r.id));
  const pickedBytes = picked.reduce(
    (sum, r) => sum + (fidelity === 'original' ? (r.file_size ?? 0) : 0),
    0,
  );
  const heading =
    chosenDay ?? chosenSession?.name ?? (chosenChapter ? chapterLabel(chosenChapter) : null);

  function setFilterKey<K extends keyof FilterQuery>(key: K, value: string) {
    setFilter((f) => {
      const next = { ...f };
      if (value) next[key] = value as FilterQuery[K];
      else delete next[key];
      return next;
    });
  }

  async function add() {
    if (!picked.length) return;
    setProblem(null);
    const files: File[] = [];
    try {
      for (const [i, row] of picked.entries()) {
        setProgress(`${i + 1}/${picked.length} · ${row.filename}`);
        files.push(...(await materialize(client, connection.id, row, { fidelity })));
      }
      onAdd(files);
      onClose();
    } catch (err) {
      setProblem(explain(err, client));
      // Whatever landed before the failure is still worth having.
      if (files.length) onAdd(files);
    } finally {
      setProgress(null);
    }
  }

  // The way out of the pictures when only one pane is on screen (<820px).
  // It cannot borrow `pill`: that class carries `inline-flex`, which outranks
  // `hidden` in the generated sheet whatever the order here.
  const backToPicker = (
    <button
      type="button"
      onClick={() =>
        view === 'day' ? setDay(null) : view === 'session' ? setSession(null) : setChapter(null)
      }
      className="hidden max-[820px]:inline-flex items-center px-3.5 py-1.5 border border-line rounded-full bg-paper text-ink-soft cursor-pointer text-[0.85rem] transition-colors"
    >
      ‹ {view === 'day' ? monthLabel(month) : view === 'session' ? 'folders' : 'legs'}
    </button>
  );

  const viewTab = (v: View, label: string, disabledWhy?: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      disabled={disabledWhy !== undefined}
      title={disabledWhy}
      className={`${pill} ${view === v ? 'bg-ink text-paper border-ink' : 'bg-paper border-line text-ink-soft hover:border-line-strong'} disabled:opacity-40 disabled:cursor-default`}
    >
      {label}
    </button>
  );

  /** `5 – 8 Nov 2025`, or one day, or nothing when the chapter is undated. */
  const chapterDates = (c: WinnowChapter) =>
    c.startDate && c.endDate && c.startDate !== c.endDate
      ? `${shortDate(c.startDate)} → ${shortDate(c.endDate)}`
      : shortDate(c.startDate ?? c.endDate);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Add from ${connection.id}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[56rem] h-[min(90dvh,52rem)] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper p-6 overflow-hidden max-[820px]:max-w-none max-[820px]:h-dvh max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:gap-3 max-[820px]:p-4 max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="m-0 font-serif text-[1.4rem] min-w-0 truncate">From {connection.id}</h2>
          <span className="text-[0.78rem] text-muted max-[560px]:hidden">
            pick a day, a folder{timelineOffered ? ' or a leg' : ''}, then the pictures — they arrive as files in the library.
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(`/connect?instance=${encodeURIComponent(connection.baseUrl)}`);
            }}
            className="p-0 border-0 bg-transparent text-[0.74rem] text-faint cursor-pointer underline underline-offset-[3px] hover:text-ink"
          >
            reconnect
          </button>
        </div>

        {/* --- view + filters: one row that narrows everything below ------ */}
        <div className="flex items-center gap-2 flex-wrap">
          {viewTab('day', 'by day')}
          {viewTab('session', 'by folder')}
          {viewTab(
            'chapter',
            'by leg',
            timelineOffered
              ? undefined
              : `${connection.id} has no timeline yet — reconnect once it does.`,
          )}
          <span className="w-px h-5 bg-line mx-1 max-[820px]:hidden" aria-hidden="true" />
          <select
            value={filter.mediaType ?? ''}
            onChange={(e) => setFilterKey('mediaType', e.target.value)}
            className={filterSelect}
            aria-label="Media type"
          >
            <option value="">photos & videos</option>
            {(facets?.media_types ?? []).map((v) => (
              <option key={String(v.value)} value={String(v.value)}>
                {v.value === 'video' ? 'videos' : 'photos'} · {v.count}
              </option>
            ))}
          </select>
          <select
            value={filter.ext ?? ''}
            onChange={(e) => setFilterKey('ext', e.target.value)}
            className={filterSelect}
            aria-label="Extension"
          >
            <option value="">any extension</option>
            {(facets?.extensions ?? []).map((v) => (
              <option key={String(v.value)} value={String(v.value)}>
                .{v.value} · {v.count}
              </option>
            ))}
          </select>
          <select
            value={filter.device ?? ''}
            onChange={(e) => setFilterKey('device', e.target.value)}
            className={filterSelect}
            aria-label="Device"
          >
            <option value="">any device</option>
            {(facets?.devices ?? []).map((v) => (
              <option key={String(v.value)} value={String(v.value)}>
                {v.value} · {v.count}
              </option>
            ))}
          </select>
          {Object.keys(filter).length > 0 && (
            <button
              type="button"
              onClick={() => setFilter({})}
              className="p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink"
            >
              clear
            </button>
          )}
        </div>

        {problem && (
          <p className="m-0 text-[0.84rem] text-[#9a3a23]" role="alert">
            {problem.text}{' '}
            {problem.login && (
              <a className="font-semibold underline underline-offset-[3px]" href={problem.login} target="_blank" rel="noreferrer">
                Sign in there
              </a>
            )}
          </p>
        )}

        {/* Two panes side by side; under 820px only ONE is on screen — the
            picker until a day or a folder is chosen, then the pictures with a
            way back. Stacking them instead put two panes in a fixed height,
            and the second one landed on top of the calendar. */}
        <div className="grid grid-cols-[18rem_1fr] gap-6 min-h-0 flex-1 overflow-hidden max-[820px]:grid-cols-1">
          {/* --- left: the month, or the folders ---------------------------- */}
          {view === 'day' ? (
            <div className={`flex flex-col gap-3 min-h-0 ${heading ? 'max-[820px]:hidden' : ''}`}>
              <div className="flex items-center gap-2">
                <button type="button" disabled={!canPrev} onClick={() => setMonth(shiftMonth(month, -1))} className={`${pill} border-line bg-paper text-ink-soft disabled:opacity-30`} aria-label="Previous month">‹</button>
                {/* One picker, years as groups: a library spanning fifteen
                    years is two clicks away, not a hundred arrow presses. */}
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className={`${select} flex-1 text-center font-serif text-[1rem] rounded-paper`}
                  aria-label="Month"
                >
                  {years.map((y) => (
                    <optgroup key={y.year} label={y.year}>
                      {y.months.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label} {y.year}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button type="button" disabled={!canNext} onClick={() => setMonth(shiftMonth(month, 1))} className={`${pill} border-line bg-paper text-ink-soft disabled:opacity-30`} aria-label="Next month">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                  <span key={i} className="text-center font-mono text-[0.58rem] text-faint">{d}</span>
                ))}
                {Array.from({ length: span.leading }, (_, i) => <span key={`pad-${i}`} />)}
                {span.days.map((iso) => {
                  const n = counts.get(iso) ?? 0;
                  const active = day === iso;
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={!n}
                      onClick={() => setDay(iso)}
                      title={n ? `${iso} · ${n} media` : iso}
                      className={`aspect-square rounded-md border text-[0.7rem] tabular-nums transition-colors max-[820px]:aspect-auto max-[820px]:min-h-[3.5rem] max-[820px]:text-[0.9rem] ${
                        active
                          ? 'bg-ink text-paper border-ink'
                          : n
                            ? 'bg-accent-wash border-[#eccabf] text-ink cursor-pointer hover:border-accent'
                            : 'bg-paper border-line text-faint'
                      }`}
                    >
                      {Number(iso.slice(-2))}
                      {n > 0 && <span className="block font-mono text-[0.52rem] leading-none opacity-70">{n}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="m-0 font-mono text-[0.62rem] text-muted">
                {calendar === null && !problem
                  ? 'asking…'
                  : bounds
                    ? `${monthLabel(month)} · media from ${bounds.min} to ${bounds.max}`
                    : 'nothing dated matches these filters'}
              </p>
            </div>
          ) : view === 'chapter' ? (
            <div className={`flex flex-col gap-2 min-h-0 overflow-auto pr-1 ${heading ? 'max-[820px]:hidden' : ''}`}>
              {chapters === null ? (
                <p className="m-0 font-mono text-[0.72rem] text-muted">{problem ? '' : 'asking…'}</p>
              ) : chapters.length === 0 ? (
                <p className="m-0 text-[0.8rem] text-muted">No leg matches these filters.</p>
              ) : (
                chapters.map((c) => {
                  const active = chapter?.id === c.id;
                  const route = c.places.map((p) => p.name).filter(Boolean).join(` ${PLACE_ARROW} `);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setChapter(c)}
                      aria-pressed={active}
                      title={route || undefined}
                      className={`text-left px-3 py-2 rounded-paper border transition-colors ${
                        active ? 'bg-ink text-paper border-ink' : 'bg-paper border-line hover:border-line-strong'
                      }`}
                    >
                      <span className="block text-[0.8rem] font-medium truncate">{chapterLabel(c)}</span>
                      <span className={`block font-mono text-[0.6rem] tabular-nums ${active ? 'opacity-70' : 'text-muted'}`}>
                        {chapterDates(c)}
                        {' · '}{c.assetCount} media
                        {c.videoCount ? ` · ${c.videoCount} ▶` : ''}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className={`flex flex-col gap-2 min-h-0 overflow-auto pr-1 ${heading ? 'max-[820px]:hidden' : ''}`}>
              {sessions === null ? (
                <p className="m-0 font-mono text-[0.72rem] text-muted">{problem ? '' : 'asking…'}</p>
              ) : sessions.length === 0 ? (
                <p className="m-0 text-[0.8rem] text-muted">No folder matches these filters.</p>
              ) : (
                sessions.map((s) => {
                  const active = session?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSession(s)}
                      aria-pressed={active}
                      title={s.source_path}
                      className={`text-left px-3 py-2 rounded-paper border transition-colors ${
                        active ? 'bg-ink text-paper border-ink' : 'bg-paper border-line hover:border-line-strong'
                      }`}
                    >
                      <span className="block text-[0.8rem] font-medium truncate">{s.name}</span>
                      <span className={`block font-mono text-[0.6rem] tabular-nums ${active ? 'opacity-70' : 'text-muted'}`}>
                        {shortDate(s.captured_at_min)}
                        {s.captured_at_max && s.captured_at_max.slice(0, 10) !== shortDate(s.captured_at_min) && ` → ${shortDate(s.captured_at_max)}`}
                        {' · '}{s.asset_count} media
                        {s.device_hint && ` · ${s.device_hint}`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* --- right: the pictures of what was chosen --------------------- */}
          <div className={`flex flex-col gap-3 min-h-0 overflow-hidden ${heading ? '' : 'max-[820px]:hidden'}`}>
            {!heading ? (
              <p className="m-0 text-[0.84rem] text-muted">
                {view === 'day'
                  ? 'Choose a day on the left.'
                  : view === 'session'
                    ? 'Choose a folder on the left.'
                    : 'Choose a leg on the left — its pictures are listed, nothing is downloaded until you add them.'}
              </p>
            ) : rows === null ? (
              <div className="flex items-center gap-3 flex-wrap">
                {backToPicker}
                <span className="font-mono text-[0.72rem] text-muted">reading {heading}…</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  {backToPicker}
                  <span className={`${legend} truncate max-w-[60%] max-[820px]:max-w-full`}>{heading} · {rows.length} media</span>
                  <button
                    type="button"
                    onClick={() =>
                      setChecked(checked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                    className="font-mono text-[0.58rem] tracking-[0.1em] uppercase text-muted hover:text-accent"
                  >
                    {checked.size === rows.length ? 'none' : 'all'}
                  </button>
                </div>
                {rows.length === 0 ? (
                  <p className="m-0 text-[0.8rem] text-muted">Nothing here matches these filters.</p>
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] auto-rows-max gap-2 content-start pr-1">
                    {rows.map((r) => {
                      const on = checked.has(r.id);
                      return (
                        <label
                          key={r.id}
                          className={`relative block rounded-md overflow-hidden border cursor-pointer bg-frame ${on ? 'border-accent shadow-[inset_0_0_0_2px_var(--color-accent)]' : 'border-line'}`}
                          title={`${r.filename}${r.has_telemetry ? ' · flight log' : ''}${r.derivative_status !== 'ready' ? ' · proxy not ready' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const next = new Set(checked);
                              if (on) next.delete(r.id);
                              else next.add(r.id);
                              setChecked(next);
                            }}
                            className="absolute top-1.5 left-1.5 z-[2] w-[15px] h-[15px] accent-ink max-[820px]:w-[20px] max-[820px]:h-[20px]"
                            aria-label={`Select ${r.filename}`}
                          />
                          {/* Served with the session cookie, so the browser is
                              told to send it cross-origin — and retried,
                              because a hundred at once down a tunnel is not
                              reliable. */}
                          <Thumb
                            src={client.thumbRetryUrl(r.id, thumbAttempt.get(r.id) ?? 0)}
                            attempt={thumbAttempt.get(r.id) ?? 0}
                            label={r.ext || (r.media_type === 'video' ? 'video' : 'photo')}
                            onFailed={() => {
                              const next = (thumbAttempt.get(r.id) ?? 0) + 1;
                              // Widening delay: these failures are load-shaped,
                              // and retrying at once makes the pile-up worse.
                              window.setTimeout(() => {
                                setThumbAttempt((m) => {
                                  const copy = new Map(m);
                                  copy.set(r.id, next);
                                  return copy;
                                });
                              }, next * 400);
                            }}
                          />
                          <span className="absolute bottom-0 inset-x-0 px-1.5 py-1 font-mono text-[0.55rem] text-paper bg-[rgba(20,18,15,0.62)] truncate">
                            {r.filename}
                            {r.media_type === 'video' && ' ▶'}
                            {r.has_telemetry && ' · srt'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* --- fidelity + go ------------------------------------------------ */}
        <div className="flex items-center gap-3 gap-y-2 flex-wrap border-t border-line pt-4 max-[560px]:pt-3">
          {/* Two groups, never one long row: the choice wraps as a block, the
              two actions stay together on the last line. */}
          <div className="flex items-center gap-3 gap-y-2 flex-wrap grow shrink basis-[20rem] min-w-0">
            <span className={legend}>bring</span>
            <button type="button" onClick={() => setFidelity('proxy')} className={`${pill} ${fidelity === 'proxy' ? 'bg-ink text-paper border-ink' : 'bg-paper border-line text-ink-soft'}`} title="Winnow's editing rendition: H.264 video, WebP photo — fast, decodes everywhere">
              proxies
            </button>
            <button type="button" onClick={() => setFidelity('original')} className={`${pill} ${fidelity === 'original' ? 'bg-ink text-paper border-ink' : 'bg-paper border-line text-ink-soft'}`} title="The full files — every byte through the tunnel">
              originals
            </button>
            <span className="text-[0.74rem] text-faint">
              {fidelity === 'proxy'
                ? 'proxies are what you edit on; exports can fetch originals later'
                : picked.length
                  ? `${formatBytes(pickedBytes)} to download`
                  : 'full-size files'}
            </span>
          </div>
          <div className="flex items-center gap-3 gap-y-2 flex-wrap justify-end ml-auto max-[560px]:w-full">
            {progress && <span className="font-mono text-[0.66rem] text-muted max-[560px]:w-full">{progress}</span>}
            <button type="button" onClick={onClose} className="p-0 border-0 bg-transparent text-[0.82rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={!picked.length || progress !== null}
              className="px-[1.1rem] py-2 inline-flex items-center justify-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-40 disabled:cursor-default max-[560px]:flex-1"
            >
              Add {picked.length || ''} to library
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
