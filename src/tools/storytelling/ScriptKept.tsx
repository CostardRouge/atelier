import { useEffect, useState, useSyncExternalStore } from 'react';
import { pillNeedsAction, pillText } from '../../shared/sources/doc-sync';
import { explainFailure, failureOf } from '../../shared/sources/doc-remote';
import { listWinnowConnections, subscribeWinnowConnections } from '../../shared/sources/winnow/store';
import { withScriptId } from '../../shared/story/script-remote';
import type { StoryScript } from '../../shared/story/story-script';
import Button from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/Inspector';
import { dropRecord, listKeptScripts, pushScript, reduceRecord, scriptRemoteFor, subscribeSync, syncRecords, takeKeptScript, type KeptSeries } from './script-sync';
import { keepVersion } from './version-store';

/** Take a kept series as this browser's script, the one it replaces kept as a version first. */
async function openKept(sourceId: string, id: string, current: StoryScript | null, onScript: (s: StoryScript) => void): Promise<string | null> {
  const remote = scriptRemoteFor(sourceId);
  if (!remote) return `${sourceId} is not connected here.`;
  try {
    const taken = await takeKeptScript(remote, id);
    if (current) void keepVersion(current, 'replaced');
    onScript(taken);
    void keepVersion(taken, 'from-winnow');
    return null;
  } catch (err) {
    return explainFailure(failureOf(err), remote).text;
  }
}

/**
 * The series kept on the connected Winnows, to open one here — the other
 * device's half of « the Mac and the phone open the same one ». Listed on
 * the click, never on the panel's open.
 */
export function KeptSeriesList({ current, onScript }: { current: StoryScript | null; onScript: (s: StoryScript) => void }) {
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const keepers = connections.filter((c) => scriptRemoteFor(c.id));
  const [listed, setListed] = useState<{ sourceId: string; rows: KeptSeries[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!keepers.length) return null;
  const list = async (sourceId: string) => {
    const remote = scriptRemoteFor(sourceId);
    if (!remote) return;
    setBusy(true);
    setError(null);
    try {
      setListed({ sourceId, rows: await listKeptScripts(remote) });
    } catch (err) {
      setError(explainFailure(failureOf(err), remote).text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {keepers.map((c) => (
          <Button key={c.id} size="sm" variant={listed?.sourceId === c.id ? 'default' : 'ghost'} disabled={busy} onClick={() => void list(c.id)}>
            Series kept on {c.id}…
          </Button>
        ))}
      </div>
      {error ? <p className="m-0 text-2xs text-danger">{error}</p> : null}
      {listed ? (
        listed.rows.length ? (
          <ul className="m-0 p-0 list-none flex flex-col gap-1">
            {listed.rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 min-h-8">
                <span className="flex-1 min-w-0 text-2xs leading-snug">
                  <span className="text-ink font-semibold">{r.summary.series}</span>
                  <span className="text-muted">
                    {' '}
                    · {r.summary.posts} post{r.summary.posts === 1 ? '' : 's'}
                    {r.summary.trip ? ` · ${r.summary.trip}` : ''}
                  </span>
                </span>
                {current?.id === r.id ? (
                  <span className="font-mono text-3xs text-muted px-1.5">open</span>
                ) : (
                  <Button size="sm" onClick={() => void openKept(listed.sourceId, r.id, current, onScript).then(setError)}>
                    Open
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-2xs text-muted">No series is kept on {listed.sourceId} yet.</p>
        )
      ) : null}
    </div>
  );
}

/**
 * Where the series is kept (`script-sync.ts`): this browser only, or a
 * Winnow — then the line the status pill would print, and the gestures each
 * state needs (sign in, settle a conflict, keep it there again, keep it
 * here only).
 */
export default function ScriptKept({ script, onScript }: { script: StoryScript; onScript: (s: StoryScript) => void }) {
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const records = useSyncExternalStore(subscribeSync, syncRecords);
  const keepers = connections.filter((c) => scriptRemoteFor(c.id));
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(id);
  }, []);
  const rec = script.id ? (records[script.id] ?? null) : null;

  const keep = async () => {
    const target = keepers.find((c) => c.id === to) ?? keepers[0];
    const remote = target ? scriptRemoteFor(target.id) : null;
    if (!remote) return;
    setError(null);
    const named = withScriptId(script);
    if (named !== script) onScript(named);
    const r = await pushScript(remote, named);
    if (r.status !== 'synced') setError(r.error ?? 'It could not be kept there.');
  };

  if (!rec) {
    if (!connections.length)
      return (
        <p className="m-0 text-2xs text-muted leading-snug">
          Kept in this browser only.{' '}
          <a className="text-accent-ink font-semibold underline underline-offset-[3px]" href="#/sources">
            Connect a Winnow
          </a>{' '}
          to keep it there, so another device opens the same series.
        </p>
      );
    if (!keepers.length)
      return (
        <p className="m-0 text-2xs text-muted leading-snug">
          Kept in this browser only: {connections.map((c) => c.id).join(', ')} {connections.length > 1 ? 'do' : 'does'} not keep series yet — its next
          version will.
        </p>
      );
    return (
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-2xs text-muted leading-snug">Kept in this browser only. On a Winnow, the Mac and the phone open the same series, and a cleared browser loses nothing.</p>
        <div className="flex items-center gap-2 flex-wrap">
          {keepers.length > 1 ? (
            <SelectField label="The Winnow to keep it on" value={to || keepers[0].id} options={keepers.map((c) => ({ id: c.id, label: c.id }))} onChange={setTo} />
          ) : null}
          <Button size="sm" variant="primary" onClick={() => void keep()}>
            Keep on {keepers.length > 1 ? (to || keepers[0].id) : keepers[0].id}
          </Button>
        </div>
        {error ? <p className="m-0 text-2xs text-danger">{error}</p> : null}
      </div>
    );
  }

  const remote = scriptRemoteFor(rec.sourceId);
  const push = async () => {
    if (!remote) return;
    const r = await pushScript(remote, script);
    setError(r.status === 'synced' ? null : (r.error ?? null));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <p className={`m-0 text-2xs leading-snug ${pillNeedsAction(rec.status) ? 'text-danger' : 'text-ink-soft'}`}>
        <span className="font-semibold">Kept on {rec.sourceId}</span> — {remote ? pillText(rec, rec.sourceId, now) : 'not connected in this browser: connect it to follow the copy there'}
      </p>
      <div className="flex flex-wrap gap-2">
        {remote && rec.status === 'conflict' ? (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                reduceRecord(rec.id, { type: 'resolvedKeepMine' });
                void push();
              }}
              title="Write this browser's script over the copy there; theirs stays one Restore away on that device"
            >
              Keep mine
            </Button>
            <Button size="sm" onClick={() => void openKept(rec.sourceId, rec.id, script, onScript).then(setError)} title="Take the copy there; this browser's is kept as a version">
              Take theirs
            </Button>
          </>
        ) : null}
        {remote && rec.status === 'unauthenticated' ? (
          <a className="text-2xs text-accent-ink font-semibold underline underline-offset-[3px] self-center" href={remote.client.loginUrl()} target="_blank" rel="noreferrer">
            Sign in to {rec.sourceId}
          </a>
        ) : null}
        {remote && rec.status === 'gone' ? (
          <Button
            size="sm"
            onClick={() => {
              dropRecord(rec.id);
              void pushScript(remote, script);
            }}
          >
            Keep it there again
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => dropRecord(rec.id)} title={`Stop following the copy on ${rec.sourceId}; it stays there, and this browser keeps its own`}>
          Keep only here
        </Button>
      </div>
      {error ? <p className="m-0 text-2xs text-danger">{error}</p> : null}
    </div>
  );
}
