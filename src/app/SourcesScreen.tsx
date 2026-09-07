import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { navigate } from './use-hash-route';
import {
  WinnowClient,
  WinnowError,
  normalizeBaseUrl,
  sourceIdFor,
} from '../shared/sources/winnow/client';
import {
  getWinnowConnection,
  listWinnowConnections,
  putWinnowConnection,
  removeWinnowConnection,
  subscribeWinnowConnections,
  type WinnowConnection,
} from '../shared/sources/winnow/store';
import { useSourceHealth } from '../shared/sources/winnow/use-source-health';
import {
  CHECKING,
  countBySource,
  describeDocs,
  forgetWarning,
  type DocCount,
  type SourceHealth,
} from '../shared/sources/source-ledger';
import { describeAgo } from '../shared/sources/doc-sync';
import { LOCAL_SOURCE } from '../shared/sources/source';
import { listProjects } from '../shared/projects/project-store';
import { listTrips } from '../shared/roadtrip/trip-store';

/** Where a connect made from a LINK lands once done — the studio's gallery. */
const AFTER_CONNECT = '/studio/home';

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const pill =
  'inline-flex items-center gap-1.5 font-mono text-[0.64rem] tracking-[0.04em] px-2 py-[0.15rem] rounded-full border whitespace-nowrap';
const btn =
  'px-3 py-[0.28rem] rounded-full border text-[0.74rem] font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-default';
const solid = `${btn} border-ink bg-ink text-paper hover:bg-accent hover:border-accent`;
const ghost = `${btn} border-line-strong bg-transparent text-ink hover:text-accent-ink hover:border-accent`;
const danger = `${btn} border-[#e0c3ba] bg-transparent text-[#9a3a23] hover:bg-[#f6e2dc]`;

/** The dot + words for a state, in the four shapes an instance can be in. */
function HealthPill({ health }: { health: SourceHealth }) {
  const dot = 'w-[7px] h-[7px] rounded-full block';
  switch (health.state) {
    case 'reachable':
      return (
        <span className={`${pill} border-[#bcd4bf] bg-[#e4efe4] text-[#3f7a52]`}>
          <i className={`${dot} bg-[#3f7a52]`} />
          reachable{health.latencyMs !== null && ` · ${health.latencyMs} ms`}
        </span>
      );
    case 'signin':
      return (
        <span className={`${pill} border-[#e3d3a8] bg-[#f5ecd6] text-[#8a6a1f]`}>
          <i className={`${dot} bg-[#8a6a1f]`} />
          sign-in needed
        </span>
      );
    case 'unreachable':
      return (
        <span className={`${pill} border-[#e0c3ba] bg-[#f6e2dc] text-[#9a3a23]`}>
          <i className={`${dot} bg-[#9a3a23]`} />
          unreachable
        </span>
      );
    default:
      return (
        <span className={`${pill} border-line-strong bg-surface text-ink-soft`}>
          <i className={`${dot} bg-faint animate-pulse-dot`} />
          asking…
        </span>
      );
  }
}

/** One fact, monospaced — the row's own facts line reads as a data strip. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label} <b className="text-ink-soft font-medium">{value}</b>
    </span>
  );
}

interface RowProps {
  glyph: string;
  remote?: boolean;
  name: string;
  aside: string | null;
  pill: React.ReactNode;
  facts: React.ReactNode;
  actions?: React.ReactNode;
  note?: React.ReactNode;
  dim?: boolean;
}

/** The one shape every source is drawn in — local and remote alike. */
function SourceRow({ glyph, remote, name, aside, pill: state, facts, actions, note, dim }: RowProps) {
  return (
    <div
      className={`grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1.5 items-start px-4 py-3.5 border rounded-paper ${
        dim ? 'border-line bg-paper/50' : 'border-line bg-surface'
      }`}
    >
      <span
        className={`row-span-2 w-8 h-8 rounded-[10px] grid place-items-center font-mono text-[0.66rem] font-bold border ${
          remote
            ? 'bg-accent-wash text-accent-ink border-[#ecd3ca]'
            : 'bg-paper-2 text-ink-soft border-line'
        }`}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <span className={`min-w-0 font-mono text-[0.9rem] font-medium ${dim ? 'text-muted' : ''}`}>
        <span className="break-all">{name}</span>
        {aside && <small className="ml-2 font-sans text-[0.74rem] text-muted">{aside}</small>}
      </span>
      <span className="col-span-2 sm:col-span-1 flex flex-wrap items-center justify-start sm:justify-end gap-1.5 order-3 sm:order-none">
        {state}
        {actions}
      </span>
      <span
        className={`col-start-2 col-span-1 sm:col-span-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.66rem] text-muted tabular-nums ${
          dim ? 'opacity-70' : ''
        }`}
      >
        {facts}
      </span>
      {note && <span className="col-start-1 col-span-2 sm:col-span-3 order-4">{note}</span>}
    </div>
  );
}

/**
 * `#/sources` (and its older name `#/connect`) — the one page where a remote
 * source enters this app, is looked at, and leaves it.
 *
 * **Connecting and managing are the same screen** (the maintainer's call,
 * 2026-09-08): a list with a form under it, rather than a connect flow that
 * writes to a store nothing renders. Before this page existed, dropping a
 * connection meant clearing site data, and a capabilities sheet read months
 * ago silently hid features that had since shipped.
 *
 * Three rules it exists to hold:
 *
 * - **Connecting is the user's act.** `?instance=` may PROPOSE a host — that
 *   is what an instance's own app rail links to — and nothing is sent until
 *   the person clicks Allow. That confirmation is what turns "a link can name
 *   any server" from an injection vector into a decision.
 * - **Opening this page re-asks every connected instance** what it can do,
 *   and stores the answer (`useSourceHealth`). The screen that reports a
 *   stale sheet is the screen that refreshes it.
 * - **A source that cannot be reached is greyed with the reason**, never
 *   hidden — the same honesty as the battery gauge drawing "—".
 */
export default function SourcesScreen({ query }: { query: string }) {
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const proposed = params.get('instance') ?? '';
  const back = params.get('return') ?? '';
  // Only a hash path of ours is honoured as a landing — never an absolute URL.
  const after = back.startsWith('/') && !back.startsWith('//') ? back : AFTER_CONNECT;
  const sentByLink = proposed !== '' || back !== '';

  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const { health, check } = useSourceHealth(connections);

  const [raw, setRaw] = useState(proposed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [counts, setCounts] = useState<Map<string, DocCount>>(new Map());

  useEffect(() => setRaw(proposed), [proposed]);

  // What each source holds, so a forget can say it before it asks. Read once
  // per visit — the two stores are local and small.
  const recount = useCallback(() => {
    void Promise.all([listProjects(), listTrips()])
      .then(([projects, trips]) => setCounts(countBySource(projects, trips, LOCAL_SOURCE.id)))
      .catch(() => setCounts(new Map()));
  }, []);
  useEffect(recount, [recount]);

  let baseUrl: string | null = null;
  let problem: string | null = null;
  try {
    baseUrl = raw.trim() ? normalizeBaseUrl(raw) : null;
  } catch (err) {
    problem = err instanceof Error ? err.message : 'That is not an address.';
  }
  const already = baseUrl ? getWinnowConnection(sourceIdFor(baseUrl)) : null;

  async function allow() {
    if (!baseUrl) return;
    setBusy(true);
    setError(null);
    setNeedsLogin(null);
    const client = new WinnowClient({ baseUrl, auth: { mode: 'cookie' } });
    try {
      const capabilities = await client.capabilities();
      const now = Date.now();
      putWinnowConnection({
        id: sourceIdFor(baseUrl),
        baseUrl,
        auth: { mode: 'cookie' },
        capabilities,
        connectedAt: already?.connectedAt ?? now,
        refreshedAt: now,
      });
      setRaw('');
      // A link that asked for a specific instance wanted to go somewhere
      // afterwards; a person adding one from this page stays on it and sees
      // the new row appear.
      if (sentByLink) navigate(after);
    } catch (err) {
      if (err instanceof WinnowError && err.kind === 'unauthenticated') {
        setNeedsLogin(client.loginUrl());
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function forget(conn: WinnowConnection) {
    removeWinnowConnection(conn.id);
    setConfirming(null);
    recount();
  }

  const localCount = counts.get(LOCAL_SOURCE.id) ?? { projects: 0, trips: 0 };

  return (
    <section
      className="w-full max-w-[46rem] mx-auto mt-8 mb-12 flex flex-col gap-6 px-1"
      aria-label="Sources"
    >
      <div>
        <p className={legend}>Sources</p>
        <h1 className="m-0 mt-1 font-serif text-[1.7rem] leading-tight">Where your work lives</h1>
        <p className="m-0 mt-1.5 text-[0.86rem] text-muted leading-relaxed">
          A project, a trip and its media belong to exactly one source. Nothing is sent anywhere —
          connecting is your click, and only ever to the address you name.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <SourceRow
          glyph="FS"
          name={LOCAL_SOURCE.label}
          aside="this browser · the folders you open"
          pill={
            <span className={`${pill} border-[#bcd4bf] bg-[#e4efe4] text-[#3f7a52]`}>
              <i className="w-[7px] h-[7px] rounded-full block bg-[#3f7a52]" />
              always on
            </span>
          }
          facts={
            <>
              <Fact label="projects" value={String(localCount.projects)} />
              <Fact label="trips" value={String(localCount.trips)} />
              <Fact label="media" value="File System Access" />
              <Fact label="documents" value="IndexedDB" />
              <Fact label="scheduling" value="—" />
            </>
          }
        />

        {connections.map((conn) => {
          const state = health.get(conn.id) ?? CHECKING;
          const caps = conn.capabilities;
          const count = counts.get(conn.id) ?? { projects: 0, trips: 0 };
          const readAt = conn.refreshedAt ?? conn.connectedAt;
          const client = new WinnowClient({ baseUrl: conn.baseUrl, auth: conn.auth });
          const down = state.state === 'unreachable' || state.state === 'signin';
          return (
            <SourceRow
              key={conn.id}
              glyph={conn.id.slice(0, 1).toUpperCase()}
              remote
              name={conn.id}
              aside={
                caps?.viewer
                  ? `${caps.viewer.username} · ${caps.viewer.role}`
                  : `read ${describeAgo(Date.now() - readAt)}`
              }
              dim={down}
              pill={<HealthPill health={state} />}
              actions={
                confirming === conn.id ? null : (
                  <>
                    {state.state === 'signin' && (
                      <a
                        className={solid}
                        href={client.loginUrl()}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Sign in there
                      </a>
                    )}
                    <button
                      type="button"
                      className={ghost}
                      onClick={() => check(conn.id)}
                      disabled={state.state === 'checking'}
                      title={`Ask ${conn.id} what it can do, and store the answer`}
                    >
                      {state.state === 'reachable' ? 'Refresh' : 'Retry'}
                    </button>
                    <button
                      type="button"
                      className={danger}
                      onClick={() => setConfirming(conn.id)}
                    >
                      Forget
                    </button>
                  </>
                )
              }
              facts={
                caps ? (
                  <>
                    <Fact label="api" value={`v${caps.api.version}`} />
                    <Fact
                      label="proxies"
                      value={`${caps.media.proxies.video.height}p / ${caps.media.proxies.photo.size}px`}
                    />
                    <Fact label="sidecars" value={caps.media.sidecars ? 'srt' : '—'} />
                    <Fact
                      label="documents"
                      value={
                        caps.documents.bucket ? (caps.documents.kinds ?? ['on']).join(' · ') : '—'
                      }
                    />
                    <Fact label="here" value={describeDocs(count)} />
                    <Fact label="read" value={describeAgo(Date.now() - readAt)} />
                  </>
                ) : (
                  <Fact label="capabilities" value="never read" />
                )
              }
              note={
                confirming === conn.id ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 border border-[#e9cfc6] bg-[#f6e2dc] rounded-paper px-3 py-2">
                    <span className="text-[0.78rem] text-[#9a3a23] leading-snug grow basis-[18rem]">
                      {forgetWarning(conn.id, count)}
                    </span>
                    <span className="flex gap-2 ml-auto">
                      <button type="button" className={danger} onClick={() => forget(conn)}>
                        Forget it
                      </button>
                      <button
                        type="button"
                        className={ghost}
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </span>
                  </div>
                ) : state.reason ? (
                  <p
                    className={`m-0 mt-1.5 text-[0.78rem] leading-snug border rounded-paper px-3 py-2 ${
                      state.state === 'signin'
                        ? 'text-[#8a6a1f] bg-[#f5ecd6] border-[#e6d7b0]'
                        : 'text-[#9a3a23] bg-[#f6e2dc] border-[#e9cfc6]'
                    }`}
                  >
                    {state.reason}
                    {count.projects + count.trips > 0 && (
                      <>
                        {' '}
                        {describeDocs(count)} came from it — the copies in this browser still open,
                        they just cannot save back.
                      </>
                    )}
                  </p>
                ) : null
              }
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border border-dashed border-line-strong rounded-paper-lg px-4 py-4">
        <label className="flex flex-col gap-1.5">
          <span className={legend}>{connections.length > 0 ? 'Connect another' : 'Connect a Winnow'}</span>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && baseUrl && !busy) void allow();
            }}
            placeholder="https://winnow.example"
            spellCheck={false}
            className="font-mono text-[16px] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
          />
          {problem && <span className="text-[0.74rem] text-[#9a3a23]">{problem}</span>}
          {!problem && baseUrl && (
            <span className="text-[0.74rem] text-faint">
              {proposed
                ? `A link asked to connect ${sourceIdFor(baseUrl)}. Check the address before allowing it.`
                : `Will be listed as source “${sourceIdFor(baseUrl)}”.`}
              {already && ' Already connected — allowing again refreshes what it can do.'}
            </span>
          )}
          {!raw.trim() && (
            <span className="text-[0.74rem] text-faint">
              An instance becomes a source: its pictures and clips browsed by day, beside your own
              folders — and, when it offers the document bucket, your trips and projects kept there.
            </span>
          )}
        </label>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={() => void allow()} disabled={!baseUrl || busy} className={solid}>
            {busy ? 'Asking…' : already ? 'Allow again' : 'Allow'}
          </button>
          <span className="text-[0.76rem] text-muted">
            One request is made — <code className="font-mono text-[0.72rem]">/api/capabilities</code>{' '}
            — and nothing is stored unless it answers.
          </span>
          {sentByLink && (
            <button type="button" onClick={() => navigate(after)} className={`${ghost} ml-auto`}>
              Not now
            </button>
          )}
        </div>

        {needsLogin && (
          <p className="m-0 text-[0.82rem] leading-relaxed border border-[#e6d7b0] bg-[#f5ecd6] rounded-paper px-3 py-2 text-[#8a6a1f]">
            That Winnow does not know you yet.{' '}
            <a
              className="text-accent-ink font-semibold underline underline-offset-[3px]"
              href={needsLogin}
              target="_blank"
              rel="noreferrer"
            >
              Sign in there
            </a>
            , then come back and allow again — the session stays in that site&apos;s cookie, never
            here.
          </p>
        )}
        {error && (
          <p className="m-0 text-[0.82rem] text-[#9a3a23] leading-relaxed" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
