import { useEffect, useState, useSyncExternalStore } from 'react';
import { PostizClient, findApi, type PostizChannel } from '../shared/sources/postiz/client';
import { forgetPostiz, getPostiz, publishChannel, putPostiz, subscribePostiz, updatePostiz, type PostizConnection } from '../shared/sources/postiz/store';
import { DEFAULT_RHYTHM, rhythmSlotLabel, type Rhythm, type RhythmSlot } from '../shared/sources/postiz/rhythm';
import { Fact, SourceRow, danger, ghost, legend, pill, solid } from './source-row';

/** The kept Postiz, live. */
export function usePostiz(): PostizConnection | null {
  return useSyncExternalStore(subscribePostiz, getPostiz, getPostiz);
}

const input = 'font-mono text-sm px-3 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = ['Europe/Paris', 'Europe/London', 'Australia/Sydney', 'Australia/Perth', 'America/New_York'];

/**
 * Sources › *Publishing* (lab 12): the person's own Postiz — the address and
 * the API key they paste, the Instagram account Recap publishes to, the
 * collaborator it proposes, and their RHYTHM (the week's slots, a ceiling a
 * week). One request on connect (`/is-connected`, then `/integrations`);
 * opening this page re-asks whether it still answers.
 */
export default function PostizRow() {
  const conn = usePostiz();
  const [state, setState] = useState<'asking' | 'ok' | 'refused' | 'down'>('asking');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conn) return;
    let alive = true;
    setState('asking');
    const client = new PostizClient(conn.apiBase, conn.apiKey);
    client
      .channels()
      .then((channels) => {
        if (!alive) return;
        setState('ok');
        updatePostiz({ channels });
      })
      .catch((err: unknown) => alive && setState(err instanceof Error && /API key/.test(err.message) ? 'refused' : 'down'));
    return () => {
      alive = false;
    };
    // Re-asked when another Postiz is connected, not on every edit of the rhythm.
  }, [conn?.apiBase, conn?.apiKey]);

  if (!conn) return <PostizConnect />;
  const channel = publishChannel(conn);
  const dot = 'w-[7px] h-[7px] rounded-full block';
  const health =
    state === 'ok' ? (
      <span className={`${pill} border-ok-line bg-ok-wash text-ok`}>
        <i className={`${dot} bg-ok`} />
        reachable
      </span>
    ) : state === 'asking' ? (
      <span className={`${pill} border-line-strong bg-surface text-ink-soft`}>
        <i className={`${dot} bg-faint animate-pulse-dot`} />
        asking…
      </span>
    ) : (
      <span className={`${pill} border-danger-line bg-danger-wash text-danger`}>
        <i className={`${dot} bg-danger`} />
        {state === 'refused' ? 'key refused' : 'unreachable'}
      </span>
    );
  return (
    <SourceRow
      glyph="PZ"
      remote
      name={new URL(conn.apiBase).host}
      aside="your Postiz · publishes to Instagram"
      pill={health}
      actions={
        confirming ? (
          <>
            <button type="button" className={danger} onClick={() => forgetPostiz()}>
              Forget it
            </button>
            <button type="button" className={ghost} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className={ghost} onClick={() => setConfirming(true)} title="Drops the address and the API key from this browser. Nothing changes in Postiz.">
            Forget
          </button>
        )
      }
      facts={
        <>
          <Fact label="accounts" value={String(conn.channels.length)} />
          <Fact label="Recap posts to" value={channel ? channel.name : 'choose one'} />
          <Fact label="rhythm" value={`${conn.rhythm.slots.length} slots · ${conn.rhythm.perWeek} a week`} />
        </>
      }
      note={
        <div className="mt-2 flex flex-col gap-3">
          {error && (
            <p className="m-0 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          <ChannelPicker conn={conn} channels={conn.channels} />
          <label className="flex flex-col gap-1">
            <span className={legend}>A collaborator Recap proposes</span>
            <input
              className={input}
              value={conn.collaborator}
              onChange={(e) => updatePostiz({ collaborator: e.target.value })}
              placeholder="instagram handle, without @"
              spellCheck={false}
              aria-label="Collaborator"
            />
          </label>
          <RhythmEditor rhythm={conn.rhythm} onChange={(rhythm) => updatePostiz({ rhythm })} onError={setError} />
        </div>
      }
    />
  );
}

function ChannelPicker({ conn, channels }: { conn: PostizConnection; channels: PostizChannel[] }) {
  const chosen = publishChannel(conn);
  if (!channels.length) return <p className="m-0 text-xs text-muted">This Postiz has no account yet: add Instagram there (Add Channel), then come back.</p>;
  return (
    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="The account Recap publishes to">
      <span className={legend}>Recap publishes to</span>
      <div className="flex flex-wrap gap-2">
        {channels.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={chosen?.id === c.id}
            disabled={c.disabled}
            onClick={() => updatePostiz({ channelId: c.id })}
            className={`inline-flex items-center gap-2 pl-1 pr-3 py-1 min-h-9 pointer-coarse:min-h-11 rounded-full border text-xs cursor-pointer disabled:opacity-40 ${chosen?.id === c.id ? 'border-accent bg-accent-wash text-ink' : 'border-line-strong text-ink-soft hover:border-accent'}`}
          >
            {c.picture ? <img src={c.picture} alt="" className="w-6 h-6 rounded-full object-cover" /> : <span className="w-6 h-6 rounded-full bg-paper-2 block" />}
            {c.name}
            <span className="font-mono text-2xs text-muted">{c.identifier}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RhythmEditor({ rhythm, onChange, onError }: { rhythm: Rhythm; onChange: (r: Rhythm) => void; onError: (e: string | null) => void }) {
  const set = (slots: RhythmSlot[]) => onChange({ ...rhythm, slots });
  const zones = [...new Set([rhythm.timeZone, ...ZONES, Intl.DateTimeFormat().resolvedOptions().timeZone])];
  return (
    <div className="flex flex-col gap-1.5">
      <span className={legend} title="Recap proposes the next free slot; past the ceiling or two the same day, it says so — it never stops you.">
        Your rhythm
      </span>
      <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
        {rhythm.slots.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <select className={input} value={s.day} aria-label={`Slot ${i + 1}: day`} onChange={(e) => set(rhythm.slots.map((x, k) => (k === i ? { ...x, day: Number(e.target.value) } : x)))}>
              {DAYS.map((d, k) => (
                <option key={d} value={k}>
                  {d}
                </option>
              ))}
            </select>
            <input type="time" className={input} value={s.time} aria-label={`Slot ${i + 1}: time`} onChange={(e) => e.target.value && set(rhythm.slots.map((x, k) => (k === i ? { ...x, time: e.target.value } : x)))} />
            <button
              type="button"
              className={ghost}
              disabled={rhythm.slots.length < 2}
              onClick={() => set(rhythm.slots.filter((_, k) => k !== i))}
              aria-label={`Remove ${rhythmSlotLabel(s)}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghost} disabled={rhythm.slots.length >= 14} onClick={() => set([...rhythm.slots, { day: 3, time: '12:00' }])}>
          + A slot
        </button>
        <label className="inline-flex items-center gap-2 text-xs text-muted">
          At most
          <input
            type="number"
            min={1}
            max={21}
            className={`${input} w-16`}
            value={rhythm.perWeek}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 21) {
                onError(null);
                onChange({ ...rhythm, perWeek: n });
              }
            }}
            aria-label="Posts a week at most"
          />
          a week
        </label>
        <select className={input} value={rhythm.timeZone} onChange={(e) => onChange({ ...rhythm, timeZone: e.target.value })} aria-label="Time zone of the slots">
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <button type="button" className={ghost} onClick={() => onChange(DEFAULT_RHYTHM)} title="Tuesday 9:00, Friday 19:00, Sunday 10:00 in Paris — three a week">
          Reset
        </button>
      </div>
    </div>
  );
}

function PostizConnect() {
  const [address, setAddress] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = address.trim().length > 0 && key.trim().length > 0;
  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const client = await findApi(address, key.trim());
      const channels = await client.channels();
      putPostiz({ apiBase: client.apiBase, apiKey: key.trim(), channels, channelId: channels.length === 1 ? channels[0].id : null, collaborator: '', rhythm: DEFAULT_RHYTHM, connectedAt: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 border border-dashed border-line-strong rounded-paper-lg px-4 py-4">
      <span className={legend}>Connect your Postiz</span>
      <span className="text-xs text-muted leading-relaxed">
        Your own Postiz publishes to Instagram for you. Recap renders a recap, sends it there and schedules it. Paste its address and an API key from its{' '}
        <strong className="font-semibold text-ink-soft">Settings › Public API</strong>; the key stays in this browser until you forget it.
      </span>
      <input className={`${input} text-base`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://postiz.example" spellCheck={false} aria-label="Postiz address" />
      <input
        className={input}
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ready && !busy) void connect();
        }}
        placeholder="API key"
        autoComplete="off"
        spellCheck={false}
        aria-label="Postiz API key"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={solid} disabled={!ready || busy} onClick={() => void connect()}>
          {busy ? 'Asking…' : 'Connect Postiz'}
        </button>
        <span className="text-xs text-muted">Two requests — is the key good, which accounts — and nothing is kept unless they answer.</span>
      </div>
      {error && (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
