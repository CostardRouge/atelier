import { useEffect, useMemo, useState } from 'react';
import { navigate } from './use-hash-route';
import {
  WinnowClient,
  WinnowError,
  normalizeBaseUrl,
  sourceIdFor,
  type WinnowCapabilities,
} from '../shared/sources/winnow/client';
import {
  getWinnowConnection,
  putWinnowConnection,
} from '../shared/sources/winnow/store';

/** Where a connect lands once done — the studio's gallery, grouped by source. */
const AFTER_CONNECT = '/studio/home';

/**
 * `#/connect?instance=https://winnow.example` — the one way a remote source
 * enters this app, and it is a USER'S act, never the app's.
 *
 * The link is typically what a Winnow instance puts in its own app rail. The
 * URL may PROPOSE an instance, so it is shown and nothing is sent until the
 * person clicks Allow: that confirmation is what turns "a link can name any
 * server" from an injection vector into a decision. With no `instance` the
 * screen simply asks for one. Atelier never pings a server at boot.
 *
 * On Allow, exactly one request is made — `/api/capabilities` — and the
 * connection is stored only if it answers. A 401 is not a failure to explain
 * away: it means "sign in there first", and the screen says so with the link.
 */
export default function ConnectScreen({ query }: { query: string }) {
  const proposed = useMemo(() => new URLSearchParams(query).get('instance') ?? '', [query]);
  const [raw, setRaw] = useState(proposed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState<string | null>(null);
  const [done, setDone] = useState<WinnowCapabilities | null>(null);

  useEffect(() => setRaw(proposed), [proposed]);

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
      putWinnowConnection({
        id: sourceIdFor(baseUrl),
        baseUrl,
        auth: { mode: 'cookie' },
        capabilities,
        connectedAt: Date.now(),
      });
      setDone(capabilities);
      // Consumed: the route rewrites itself so a reload does not re-propose.
      navigate(AFTER_CONNECT);
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

  return (
    <section className="max-w-[40rem] mx-auto mt-10 flex flex-col gap-5" aria-label="Connect a source">
      <div>
        <h1 className="m-0 font-serif text-[1.6rem] leading-tight">Connect a Winnow</h1>
        <p className="m-0 mt-1 text-[0.86rem] text-muted leading-relaxed">
          A Winnow instance becomes a source: its pictures and clips, browsed by
          day, added to the library beside your folders. Nothing is sent until you
          allow it, and only ever to the address below.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted">
          Instance
        </span>
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && baseUrl && !busy) void allow();
          }}
          placeholder="https://winnow.example"
          spellCheck={false}
          className="font-mono text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
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
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => void allow()}
          disabled={!baseUrl || busy}
          className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-40 disabled:cursor-default"
        >
          {busy ? 'Asking…' : already ? 'Allow again' : 'Allow'}
        </button>
        <button
          type="button"
          onClick={() => navigate(AFTER_CONNECT)}
          className="p-0 border-0 bg-transparent text-[0.82rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink"
        >
          Not now
        </button>
      </div>

      {needsLogin && (
        <p className="m-0 text-[0.84rem] leading-relaxed border border-line rounded-paper-lg bg-paper px-4 py-3">
          That Winnow does not know you yet. <a className="text-accent-ink font-semibold underline underline-offset-[3px]" href={needsLogin} target="_blank" rel="noreferrer">Sign in there</a>, then come back and allow again — the session stays in that site&apos;s cookie, never here.
        </p>
      )}
      {error && (
        <p className="m-0 text-[0.84rem] text-[#9a3a23] leading-relaxed" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="m-0 text-[0.8rem] text-muted font-mono">
          connected as {done.viewer?.username ?? '?'} · {done.viewer?.role ?? '?'} · proxies{' '}
          {done.media.proxies.video.height}p / {done.media.proxies.photo.size}px
        </p>
      )}
    </section>
  );
}
