import { useEffect, useMemo, useRef, useState } from 'react';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { bpmOf, cutsOnBeat } from '../../shared/recap/recap-beat';
import { musicFor, withMusic, type PublishKind } from '../../shared/recap/recap-publish';
import type { PostizChannel, PostizClient } from '../../shared/sources/postiz/client';
import NetworkMark from '../../shared/sources/postiz/NetworkMark';
import { musicLibrary, networkOf, type MusicTrack, type Network } from '../../shared/sources/postiz/networks';
import Button from '../../shared/ui/Button';
import { SliderRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { Change } from './RecapPanels';
import { useTrackPlayer, useTrackStudy, type TrackStudy } from './use-track-audio';

/** A music library reached through one of the accounts ticked. */
interface Library {
  net: Network;
  /** The account the search goes through. */
  channel: PostizChannel;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const field = 'font-sans text-sm px-3 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';
const round =
  'flex-none grid place-items-center w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-full border-0 bg-ink text-paper text-2xs cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** A track's cover, or a quiet block when the library gave none. */
function Cover({ track, className }: { track: Pick<MusicTrack, 'image'>; className: string }) {
  const [broken, setBroken] = useState(false);
  return track.image && !broken ? (
    <img src={track.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`flex-none rounded-[6px] object-cover bg-paper-2 ${className}`} />
  ) : (
    <span aria-hidden="true" className={`flex-none rounded-[6px] bg-[linear-gradient(140deg,var(--color-line-strong),var(--color-paper-2))] ${className}`} />
  );
}

/** What was searched in a library, kept for the visit: every search is a request to his Postiz. */
const found = new Map<string, MusicTrack[]>();
const asking = new Map<string, Promise<MusicTrack[]>>();

/**
 * *Sound* (lab 18, his Q4): the recap's own sound everywhere, or — the
 * default — a track of the network's own library where an account ticked has
 * one through Postiz (Instagram with the Facebook Business connector, TikTok
 * Business), the other networks keeping the recap's own.
 *
 * His two walls with Postiz's own picker: no way to HEAR a track (here every
 * one plays, and plays with the film on the stage), and a publication failing
 * on the file (the foot's safe file answers that). What stays the network's:
 * WHICH excerpt it plays — its API takes a track, never a moment.
 */
export default function PublishSound({
  doc,
  change,
  client,
  going,
  kind,
  cuts,
  onWithFilm,
}: {
  doc: RecapDoc;
  change: Change;
  client: PostizClient;
  going: readonly PostizChannel[];
  kind: PublishKind;
  /** When the film cuts, in seconds — what a track's tempo is measured against. */
  cuts: readonly number[];
  /** Plays the film on the stage from its first second with this track over it. */
  onWithFilm: (over: { url: string; music: number; film: number } | null) => void;
}) {
  const music = doc.publish.music;
  const set = (patch: Parameters<typeof withMusic>[1]) => change((d) => withRecap(d, { publish: withMusic(d.publish, patch) }));
  const libraries = useMemo(() => {
    const out: Library[] = [];
    for (const channel of going) {
      const net = networkOf(channel.identifier);
      if (net && musicLibrary(channel.identifier) && !out.some((l) => l.net.id === net.id)) out.push({ net, channel });
    }
    return out;
  }, [going]);
  const [picking, setPicking] = useState<string | null>(null);
  const player = useTrackPlayer();
  const hears = going.map((channel) => ({ channel, net: networkOf(channel.identifier)!, track: musicFor(doc.publish, channel.identifier, kind)?.track ?? null }));
  const anyTrack = hears.some((h) => h.track);

  return (
    <div className="flex flex-col gap-2.5">
      <Segmented
        size="sm"
        fill
        label="What it sounds like"
        value={music.source}
        onChange={(source) => set({ source: source === 'own' ? 'own' : 'network' })}
        options={[
          { id: 'own', label: 'Recap’s sound', title: 'Every network hears the recap’s own sound, as set in Background › Sound' },
          { id: 'network', label: 'Network music', title: 'A track of the network’s own library where an account has one; the others keep the recap’s sound' },
        ]}
      />
      {music.source === 'own' ? (
        <p className="m-0 text-2xs text-muted leading-relaxed">{doc.sound ? 'Every network hears the recap’s own sound, encoded in the file.' : 'This recap has no sound: it goes out silent. Add one in Background, or pick a network’s music.'}</p>
      ) : kind !== 'reel' ? (
        <p className="m-0 text-2xs text-muted leading-relaxed">A network lays its music over a Reel only: this {kind} goes out with {doc.sound ? 'the recap’s own sound' : 'no sound'}.</p>
      ) : !libraries.length ? (
        <p className="m-0 text-2xs text-muted leading-relaxed">None of the accounts ticked has a music library through Postiz. Instagram has one with the Facebook Business connector, TikTok with a Business account.</p>
      ) : (
        <>
          {libraries.map((lib) => (
            <LibraryTrack
              key={lib.net.id}
              lib={lib}
              track={music.tracks[lib.net.id] ?? null}
              cuts={cuts}
              player={player}
              open={picking === lib.net.id}
              onOpen={(o) => setPicking(o ? lib.net.id : null)}
              client={client}
              onPick={(track) => {
                set({ tracks: { ...music.tracks, [lib.net.id]: track } });
                setPicking(null);
              }}
              onClear={() => set({ tracks: Object.fromEntries(Object.entries(music.tracks).filter(([k]) => k !== lib.net.id)) })}
              onWithFilm={(track) => {
                player.stop();
                onWithFilm(track.previewUrl ? { url: track.previewUrl, music: music.musicVolume / 100, film: music.filmVolume / 100 } : null);
              }}
            />
          ))}
          {anyTrack && (
            <div className="flex flex-col gap-2">
              <SliderRow label="Music" value={music.musicVolume} min={0} max={100} step={5} format={(v) => `${v}`} onChange={(musicVolume) => set({ musicVolume })} />
              <SliderRow label="Film’s sound" value={music.filmVolume} min={0} max={100} step={5} format={(v) => `${v}`} onChange={(filmVolume) => set({ filmVolume })} />
            </div>
          )}
        </>
      )}
      {going.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-1" aria-label="What each account hears">
          {hears.map(({ channel, net, track }) => (
            <li key={channel.id} className="flex items-center gap-2 text-2xs text-ink-soft min-w-0">
              <NetworkMark identifier={channel.identifier} size="xs" title={`${channel.name} · ${net.label}`} />
              <span className="min-w-0 truncate">
                {track ? (
                  <>
                    <b className="font-medium text-ink">{track.title}</b> · from {net.label}’s library
                  </>
                ) : doc.sound ? (
                  'the recap’s own sound'
                ) : (
                  'no sound'
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LibraryTrack({
  lib,
  track,
  cuts,
  player,
  open,
  onOpen,
  client,
  onPick,
  onClear,
  onWithFilm,
}: {
  lib: Library;
  track: MusicTrack | null;
  cuts: readonly number[];
  player: ReturnType<typeof useTrackPlayer>;
  open: boolean;
  onOpen: (open: boolean) => void;
  client: PostizClient;
  onPick: (track: MusicTrack) => void;
  onClear: () => void;
  onWithFilm: (track: MusicTrack) => void;
}) {
  const study = useTrackStudy(track);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2.5 p-2 rounded-control border border-line-strong bg-paper">
        {track ? <Cover track={track} className="w-11 h-11" /> : <NetworkMark identifier={lib.channel.identifier} className="w-11 h-11" />}
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink truncate">{track ? track.title : `${lib.net.label}’s music`}</div>
          <div className="font-mono text-3xs text-muted truncate">{track ? [track.artist, track.seconds ? mmss(track.seconds) : null, tempoWords(study, cuts)].filter(Boolean).join(' · ') : 'no track yet: the recap’s own sound'}</div>
        </div>
        <Button size="sm" variant={open ? 'primary' : 'default'} aria-expanded={open} onClick={() => onOpen(!open)}>
          {open ? 'Done' : track ? 'Change' : 'Choose'}
        </Button>
      </div>
      {track && !open && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <button type="button" className={round} aria-label={player.playing === track.id ? `Stop ${track.title}` : `Listen to ${track.title}`} onClick={() => player.toggle(track)}>
              {player.playing === track.id ? '❚❚' : '▶'}
            </button>
            <Wave study={study} progress={player.playing === track.id ? player.progress : 0} />
          </div>
          {player.failed === track.id && <span className="text-2xs text-warn">This address to listen has run out. Choose the track again to get a fresh one.</span>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Button size="sm" variant="ghost" onClick={() => onWithFilm(track)} disabled={!track.previewUrl} title="Plays the film on the stage from its first second, this track over it at the volumes below">
              ▶ With the film
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear} title={`Send it to ${lib.net.label} with the recap’s own sound`}>
              No track
            </Button>
            <span className="font-mono text-3xs text-muted" title={`${lib.net.label}’s API takes a track, never a moment of it: the network picks the excerpt it plays over a Reel. Send a Trial Reel to hear which.`}>
              {lib.net.label} picks the excerpt ⓘ
            </span>
          </div>
        </div>
      )}
      {open && <TrackPicker lib={lib} client={client} chosen={track?.id ?? null} player={player} onPick={onPick} />}
    </div>
  );
}

/** `92 bpm ✓` when the track's tempo suits the film's cuts, `92 bpm` when measured, nothing before. */
function tempoWords(study: TrackStudy | null, cuts: readonly number[]): string | null {
  if (!study?.beat) return null;
  return `${bpmOf(study.beat)} bpm${cutsOnBeat(study.beat.period, cuts) ? ' ✓ suits your cuts' : ''}`;
}

/** The track as bars, what has played in the accent; a plain line where this browser could not read the file. */
function Wave({ study, progress }: { study: TrackStudy | null; progress: number }) {
  if (!study?.peaks)
    return (
      <div className="flex-1 h-1 rounded-full bg-line overflow-hidden" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
      </div>
    );
  return (
    <div className="flex-1 flex items-center gap-px h-8" aria-hidden="true">
      {study.peaks.map((v, i) => (
        <span key={i} className={`flex-1 rounded-[1px] ${i / study.peaks!.length < progress ? 'bg-accent' : 'bg-line-strong'}`} style={{ height: `${Math.max(8, v * 100)}%` }} />
      ))}
    </div>
  );
}

function TrackPicker({ lib, client, chosen, player, onPick }: { lib: Library; client: PostizClient; chosen: string | null; player: ReturnType<typeof useTrackPlayer>; onPick: (track: MusicTrack) => void }) {
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = `${lib.channel.id}:${asked.toLowerCase()}`;
    const kept = found.get(key);
    if (kept) {
      setTracks(kept);
      setError(null);
      return;
    }
    // One request per search, even when this mounts twice: a search still on its way is shared.
    let alive = true;
    setTracks(null);
    setError(null);
    const going = asking.get(key) ?? client.searchMusic(lib.channel, asked);
    asking.set(key, going);
    going
      .then((list) => {
        found.set(key, list);
        if (alive) setTracks(list);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setTracks([]);
      })
      .finally(() => asking.delete(key));
    return () => {
      alive = false;
    };
  }, [asked, client, lib.channel]);
  return (
    <div className="flex flex-col rounded-control border border-line-strong bg-surface overflow-hidden">
      <form
        className="flex gap-1.5 p-2 border-b border-line"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked(q.trim());
        }}
      >
        <input ref={input} className={`${field} flex-1 min-w-0`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${lib.net.label}’s music`} aria-label={`Search ${lib.net.label}’s music`} enterKeyHint="search" />
        <Button size="sm" type="submit">
          Search
        </Button>
      </form>
      <span className="px-2.5 pt-1.5 font-mono text-3xs tracking-[0.1em] uppercase text-muted">{asked ? `“${asked}”` : 'Trending'}</span>
      <ul className="m-0 p-0 list-none flex flex-col max-h-72 overflow-y-auto overscroll-contain" aria-label={`${lib.net.label}’s tracks`} aria-busy={tracks === null}>
        {tracks === null && <li className="px-2.5 py-3 text-2xs text-muted">Asking your Postiz…</li>}
        {error && <li className="px-2.5 py-3 text-2xs text-warn">{error}</li>}
        {tracks?.length === 0 && !error && <li className="px-2.5 py-3 text-2xs text-muted">Nothing under that name.</li>}
        {tracks?.map((t) => (
          <li key={t.id} className={`grid grid-cols-[auto_2.5rem_minmax(0,1fr)_auto] items-center gap-2.5 px-2.5 py-1.5 min-h-14 border-b border-line last:border-b-0 ${chosen === t.id ? 'bg-accent-wash' : ''}`}>
            <button type="button" className={round} disabled={!t.previewUrl} aria-label={player.playing === t.id ? `Stop ${t.title}` : `Listen to ${t.title}`} onClick={() => player.toggle(t)}>
              {player.playing === t.id ? '❚❚' : '▶'}
            </button>
            <Cover track={t} className="w-10 h-10" />
            <button type="button" className="min-w-0 self-stretch flex flex-col justify-center p-0 border-0 bg-transparent text-left cursor-pointer rounded-[6px] focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onPick(t)} title="Use this track">
              <span className="text-xs font-medium text-ink truncate">{t.title}</span>
              <span className="text-2xs text-muted truncate">{t.artist}</span>
              {player.playing === t.id && (
                <span className="mt-1 h-[3px] rounded-full bg-line overflow-hidden" aria-hidden="true">
                  <span className="block h-full bg-accent" style={{ width: `${player.progress * 100}%` }} />
                </span>
              )}
            </button>
            <span className="flex flex-col items-end gap-1">
              <span className="font-mono text-3xs text-muted tabular-nums">{t.seconds ? mmss(t.seconds) : ''}</span>
              <Button size="sm" variant={chosen === t.id ? 'primary' : 'default'} onClick={() => onPick(t)}>
                {chosen === t.id ? 'Chosen' : 'Use'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
