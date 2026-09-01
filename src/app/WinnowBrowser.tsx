import { useEffect, useMemo, useState } from 'react';
import { navigate } from './use-hash-route';
import {
  WinnowClient,
  WinnowError,
  type WinnowAssetRow,
  type WinnowCalendar,
} from '../shared/sources/winnow/client';
import { materialize, type Fidelity } from '../shared/sources/winnow/materialize';
import { monthKeyOf, monthLabel, monthSpan, shiftMonth } from '../shared/sources/winnow/month';
import { type WinnowConnection } from '../shared/sources/winnow/store';
import { formatBytes } from '../shared/lib/format';

interface WinnowBrowserProps {
  connection: WinnowConnection;
  onAdd: (files: File[]) => void;
  onClose: () => void;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const pill =
  'px-3 py-1 inline-flex items-center border rounded-full cursor-pointer text-[0.78rem] transition-colors';

/** One line a person can act on, for whatever the client threw. */
function explain(err: unknown, client: WinnowClient): { text: string; login?: string } {
  if (err instanceof WinnowError && err.kind === 'unauthenticated') {
    return { text: `Not signed in to ${client.config.baseUrl}.`, login: client.loginUrl() };
  }
  return { text: err instanceof Error ? err.message : String(err) };
}

/**
 * Browse a connected Winnow by DAY and pull pictures into the library.
 *
 * Day-first because Road Trip is day-keyed: "everything from 9 July" is the
 * question the grid asks, and `/api/assets/calendar` answers it directly with
 * a count and a cover per day. A month is one request; a day is one more.
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

  const [month, setMonth] = useState<string>(() => monthKeyOf(new Date().toISOString()));
  const [calendar, setCalendar] = useState<WinnowCalendar | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [rows, setRows] = useState<WinnowAssetRow[] | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set());
  const [fidelity, setFidelity] = useState<Fidelity>('proxy');
  const [problem, setProblem] = useState<{ text: string; login?: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The month's calendar. On first answer, jump to the newest month that has
  // media — a fresh view opening on an empty month reads as a broken source.
  useEffect(() => {
    let cancelled = false;
    const span = monthSpan(month);
    setCalendar(null);
    setProblem(null);
    client
      .calendar(span.from, span.to)
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
  }, [client, month, landed]);

  // The chosen day's rows, oldest first.
  useEffect(() => {
    if (!day) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setRows(null);
    setChecked(new Set());
    client
      .allAssets({ dateFrom: day, dateTo: day })
      .then((all) => {
        if (!cancelled) setRows(all);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      });
    return () => {
      cancelled = true;
    };
  }, [client, day]);

  const span = monthSpan(month);
  const counts = new Map((calendar?.days ?? []).map((d) => [d.date, d.count]));
  const bounds = calendar?.bounds ?? null;
  const canPrev = !bounds || month > monthKeyOf(bounds.min);
  const canNext = !bounds || month < monthKeyOf(bounds.max);

  const picked = (rows ?? []).filter((r) => checked.has(r.id));
  const pickedBytes = picked.reduce(
    (sum, r) => sum + (fidelity === 'original' ? (r.file_size ?? 0) : 0),
    0,
  );

  async function add() {
    if (!picked.length) return;
    setProblem(null);
    const files: File[] = [];
    try {
      for (const [i, row] of picked.entries()) {
        setProgress(`${i + 1}/${picked.length} · ${row.filename}`);
        files.push(
          ...(await materialize(client, connection.id, row, { fidelity })),
        );
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Add from ${connection.id}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[56rem] h-[min(90vh,52rem)] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper p-6 overflow-hidden">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="m-0 font-serif text-[1.4rem]">From {connection.id}</h2>
          <span className="text-[0.78rem] text-muted">
            pick a day, then the pictures — they arrive as files in the library.
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

        <div className="grid grid-cols-[18rem_1fr] gap-6 min-h-0 flex-1 overflow-hidden max-[820px]:grid-cols-1">
          {/* --- the month ------------------------------------------------ */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center gap-2">
              <button type="button" disabled={!canPrev} onClick={() => setMonth(shiftMonth(month, -1))} className={`${pill} border-line bg-paper text-ink-soft disabled:opacity-30`} aria-label="Previous month">‹</button>
              <span className="flex-1 text-center font-serif text-[1.05rem]">{monthLabel(month)}</span>
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
                    className={`aspect-square rounded-md border text-[0.7rem] tabular-nums transition-colors ${
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
                  ? `media from ${bounds.min} to ${bounds.max}`
                  : 'this instance holds no dated media'}
            </p>
          </div>

          {/* --- the day -------------------------------------------------- */}
          <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
            {!day ? (
              <p className="m-0 text-[0.84rem] text-muted">Choose a day on the left.</p>
            ) : rows === null ? (
              <p className="m-0 font-mono text-[0.72rem] text-muted">reading {day}…</p>
            ) : (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={legend}>{day} · {rows.length} media</span>
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
                          className="absolute top-1.5 left-1.5 z-[2] w-[15px] h-[15px] accent-ink"
                          aria-label={`Select ${r.filename}`}
                        />
                        {/* The thumbnail is served with the session cookie, so
                            the browser must be told to send it cross-origin. */}
                        <img src={client.thumbUrl(r.id)} crossOrigin="use-credentials" alt="" className="block w-full h-[90px] object-cover" loading="lazy" />
                        <span className="absolute bottom-0 inset-x-0 px-1.5 py-1 font-mono text-[0.55rem] text-paper bg-[rgba(20,18,15,0.62)] truncate">
                          {r.filename}
                          {r.media_type === 'video' && ' ▶'}
                          {r.has_telemetry && ' · srt'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* --- fidelity + go ------------------------------------------------ */}
        <div className="flex items-center gap-3 flex-wrap border-t border-line pt-4">
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
          <span className="flex-1" />
          {progress && <span className="font-mono text-[0.66rem] text-muted">{progress}</span>}
          <button type="button" onClick={onClose} className="p-0 border-0 bg-transparent text-[0.82rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={!picked.length || progress !== null}
            className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-40 disabled:cursor-default"
          >
            Add {picked.length || ''} to library
          </button>
        </div>
      </div>
    </div>
  );
}
