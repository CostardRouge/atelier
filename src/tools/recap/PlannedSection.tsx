import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { HIDDEN_NOTE, hiddenInWeek, mondayOf, plannedPeek, plannedTiles, plannedWeeks, tileState, weekLabel, weekStrip, type PlannedItem, type PlannedTile, type StripDay } from '../../shared/recap/recap-planned';
import { PostizClient, failureHint, postizHome, type PostizPost } from '../../shared/sources/postiz/client';
import NetworkMark from '../../shared/sources/postiz/NetworkMark';
import { networkOf } from '../../shared/sources/postiz/networks';
import { slotLabel } from '../../shared/sources/postiz/rhythm';
import { usePostiz } from '../../shared/sources/postiz/use-postiz';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { AnchoredPopover } from '../../shared/ui/OverflowMenu';
import Button, { buttonClass } from '../../shared/ui/Button';
import { GallerySection } from './GallerySections';
import { askSendAgain } from './publish-where';
import { getPostThumb, getThumb, putRecap } from './recap-store';

const KIND: Record<string, string> = { reel: 'Reel', carousel: 'Carousel', story: 'Story' };
const STATE: Record<PlannedItem['state'], string> = { queue: 'scheduled', published: 'out', error: 'failed', draft: 'draft' };
const DAY = 86400000;
/** How far the strip can go: what is read from Postiz once, when the gallery opens. */
const BACK_WEEKS = 5;
const AHEAD_WEEKS = 8;

const networkLabel = (i: PlannedItem) => (i.network ? (networkOf(i.network)?.label ?? i.network) : (i.channel?.name ?? 'Postiz'));

/** What a send shows of itself: the vignette kept when it was sent (any of its posts'), else its recap's poster, else its account. */
function Vignette({ tile, doc, className = '' }: { tile: PlannedTile; doc: RecapDoc | undefined; className?: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const ids = tile.items.map((i) => i.postId).join(',');
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const id of ids.split(',')) {
        const b = await getPostThumb(id);
        if (b) return b;
      }
      return doc ? getThumb(doc.id) : null;
    })().then((b) => alive && setBlob(b));
    return () => {
      alive = false;
    };
  }, [ids, doc]);
  const url = useObjectUrl(blob);
  if (url) return <img src={url} alt="" className={`absolute inset-0 w-full h-full object-cover ${className}`} />;
  const first = tile.items[0];
  return (
    <span className={`absolute inset-0 grid place-items-center bg-frame ${className}`} aria-hidden="true">
      <NetworkMark identifier={first.network ?? ''} picture={first.channel?.picture} className="w-9 h-9" />
    </span>
  );
}

/** A send's networks as a stack of marks (lab 18): the one that failed ringed in red. */
function Marks({ tile, size = 'sm' }: { tile: PlannedTile; size?: 'xs' | 'sm' }) {
  return (
    <span className="flex items-center">
      {tile.items.map((i, k) => (
        <NetworkMark
          key={i.postId}
          identifier={i.network ?? ''}
          size={size}
          title={`${networkLabel(i)} · ${STATE[i.state]}`}
          className={`${k ? '-ml-1.5' : ''} ${i.state === 'error' ? 'shadow-[0_0_0_2px_var(--color-danger)] z-[1]' : 'shadow-[0_0_0_2px_rgba(16,14,12,0.7)]'}`}
        />
      ))}
    </span>
  );
}

const KIND_ICON: Record<string, ReactNode> = {
  reel: <path d="M3 2l7 4-7 4z" />,
  carousel: (
    <>
      <rect x="1" y="2" width="7" height="8" rx="1.2" />
      <rect x="9" y="3" width="2" height="6" rx=".8" />
    </>
  ),
  story: <circle cx="6" cy="6" r="4.2" fill="none" stroke="#fff" strokeWidth="1.6" />,
};
const glass = 'bg-[rgba(16,14,12,0.62)] backdrop-blur-[6px] text-white';

/**
 * The gallery's *Planned* (lab 14, his pick: «une bande par semaine»): one
 * week of seven days — what went out, what will, what failed, and the
 * rhythm's slots still free — scrolling sideways on a phone, today first.
 * Atelier makes and sends; the whole calendar is Postiz's, one link away.
 * A SEND is one tile (lab 18): the same recap on several networks shows once,
 * its networks stacked on it, the one that failed ringed. The tile is a
 * button (lab 14's A): it opens a small card with what it is, each network's
 * state, a failure's reason and what to do, and the verbs of its state.
 */
export default function PlannedSection({
  recaps,
  open,
  onToggle,
  onOpen,
  onChanged,
}: {
  recaps: readonly RecapDoc[];
  open: boolean;
  onToggle: () => void;
  onOpen: (doc: RecapDoc) => void;
  /** A recap was written here (a publication forgotten): the gallery reads its list again. */
  onChanged: () => void;
}) {
  const conn = usePostiz();
  const [posts, setPosts] = useState<PostizPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState<{ tile: PlannedTile; el: HTMLElement } | null>(null);
  const client = useMemo(() => (conn ? new PostizClient(conn.apiBase, conn.apiKey) : null), [conn?.apiBase, conn?.apiKey]);
  const load = useCallback(async () => {
    if (!client) return;
    const now = Date.now();
    try {
      setPosts(await client.posts(new Date(now - (BACK_WEEKS + 1) * 7 * DAY), new Date(now + (AHEAD_WEEKS + 1) * 7 * DAY)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPosts([]);
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  const tz = conn?.rhythm.timeZone ?? 'Europe/Paris';
  const now = new Date();
  const monday = mondayOf(now, tz, offset);
  const days = useMemo(() => (conn ? weekStrip(posts ?? [], recaps, conn.rhythm, monday, new Date()) : []), [posts, recaps, conn, monday]);
  const weeks = useMemo(() => plannedWeeks(posts ?? [], recaps, tz), [posts, recaps, tz]);
  const hidden = useMemo(() => hiddenInWeek(posts ?? [], recaps, tz, monday), [posts, recaps, tz, monday]);

  // On a phone the strip overflows: today is brought to its left edge, never the page scrolled.
  const strip = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    const today = el?.querySelector<HTMLElement>('[data-today="true"]');
    if (el && today && el.scrollWidth > el.clientWidth) el.scrollLeft = today.offsetLeft - el.offsetLeft;
  }, [open, offset, posts]);

  if (!conn) return null;
  const byId = new Map(recaps.map((d) => [d.id, d]));
  const docOf = (tile: PlannedTile) => {
    const id = tile.items.find((i) => i.recapId)?.recapId;
    return id ? byId.get(id) : undefined;
  };
  const inWeek = days.reduce((n, d) => n + d.tiles.length, 0);
  const failed = weeks.some((w) => plannedTiles(w.items).some((t) => tileState(t) === 'error'));
  return (
    <GallerySection
      id="planned"
      title="Planned"
      count={posts === null ? null : inWeek}
      hot={failed}
      open={open}
      onToggle={onToggle}
      peek={<span className="text-xs text-muted whitespace-nowrap overflow-hidden text-ellipsis" title={HIDDEN_NOTE}>{posts === null ? 'asking your Postiz…' : plannedPeek(weeks, tz, now, (d) => slotLabel(d, tz))}</span>}
      actions={
        <span className="flex items-center gap-1">
          {open && (
            <>
              {offset !== 0 && (
                <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setOffset(0)}>
                  This week
                </button>
              )}
              <button type="button" className={buttonClass('ghost', 'sm')} aria-label="Previous week" disabled={offset <= -BACK_WEEKS} onClick={() => setOffset((o) => o - 1)}>
                ‹
              </button>
              <span className="hidden sm:inline text-xs text-ink tabular-nums whitespace-nowrap px-1">{weekLabel(monday)}</span>
              <button type="button" className={buttonClass('ghost', 'sm')} aria-label="Next week" disabled={offset >= AHEAD_WEEKS} onClick={() => setOffset((o) => o + 1)}>
                ›
              </button>
            </>
          )}
          <a href={postizHome(conn.apiBase)} target="_blank" rel="noreferrer" className={buttonClass('default', 'sm')} title="The whole calendar, in your Postiz">
            Postiz ↗
          </a>
        </span>
      }
    >
      {error && <p className="m-0 mb-2 text-xs text-warn">{error}</p>}
      <div ref={strip} className="grid grid-flow-col auto-cols-[42%] sm:auto-cols-[minmax(7.75rem,1fr)] gap-2 overflow-x-auto snap-x snap-mandatory pb-1.5" role="list" aria-label={`The week of ${weekLabel(monday)}`}>
        {days.map((d) => (
          <Day key={d.day} d={d} tz={tz} docOf={docOf} onPick={(tile, el) => setActive((cur) => (cur?.tile.key === tile.key ? null : { tile, el }))} />
        ))}
      </div>
      {hidden > 0 && (
        <p className="m-0 mt-1 text-3xs text-muted" title={HIDDEN_NOTE}>
          {hidden === 1 ? '1 post from another app hidden' : `${hidden} posts from other apps hidden`} · {hidden === 1 ? 'it still takes its slot' : 'they still take their slots'}
        </p>
      )}
      {active && (
        <SendCard
          tile={active.tile}
          anchor={active.el}
          doc={docOf(active.tile)}
          tz={tz}
          postiz={postizHome(conn.apiBase)}
          onClose={() => setActive(null)}
          onOpen={onOpen}
          onDelete={async (items, doc) => {
            // Each post is its own in Postiz: one that will not go is said, the others still do.
            const gone: string[] = [];
            let failure: unknown = null;
            for (const i of items) {
              try {
                await client!.deletePost(i.postId);
                gone.push(i.postId);
              } catch (err) {
                failure = err;
              }
            }
            if (doc && gone.length) {
              await putRecap(withRecap(doc, { publish: { ...doc.publish, publications: doc.publish.publications.filter((p) => !gone.includes(p.postId)) } }));
              onChanged();
            }
            await load();
            if (failure) throw failure;
            setActive(null);
          }}
        />
      )}
    </GallerySection>
  );
}

function Day({ d, tz, docOf, onPick }: { d: StripDay; tz: string; docOf: (tile: PlannedTile) => RecapDoc | undefined; onPick: (tile: PlannedTile, el: HTMLElement) => void }) {
  const [wd, n] = d.label.split(' ');
  return (
    <div role="listitem" data-today={d.today} className="snap-start min-w-0 flex flex-col gap-2">
      <div className={`flex items-baseline gap-1.5 px-0.5 pb-1.5 border-b ${d.today ? 'border-accent' : 'border-line'}`}>
        <span className={`font-serif text-2xl leading-none ${d.today ? 'text-accent-ink' : d.past ? 'text-muted' : 'text-ink'}`}>{n}</span>
        <span className="font-mono text-3xs tracking-[0.12em] uppercase text-muted">{wd}</span>
        {d.today && <span className="ml-auto font-mono text-3xs tracking-[0.12em] uppercase text-accent-ink">today</span>}
      </div>
      {d.tiles.map((tile) => {
        const doc = docOf(tile);
        const first = tile.items[0];
        const state = tileState(tile);
        const time = slotLabel(tile.at, tz).split(' · ')[1];
        const caption = doc?.title ?? first.title;
        const failed = tile.items.filter((i) => i.state === 'error');
        const many = tile.items.length > 1;
        return (
          <button
            key={tile.key}
            type="button"
            aria-haspopup="dialog"
            aria-label={`${caption || 'No caption'}, ${time}, ${many ? `${tile.items.length} networks, ` : ''}${STATE[state]}`}
            onClick={(e) => onPick(tile, e.currentTarget)}
            className="group flex flex-col gap-1.5 p-0 border-0 bg-transparent text-left cursor-pointer rounded-paper focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[3px]"
          >
            <span
              className={`relative block aspect-[4/5] rounded-paper overflow-hidden bg-surface transition-transform duration-150 ease-paper motion-safe:group-hover:-translate-y-0.5 ${
                state === 'error' ? 'shadow-[0_0_0_2px_var(--color-danger)]' : 'shadow-paper-soft'
              } ${d.past ? 'saturate-[.75]' : ''}`}
            >
              <Vignette tile={tile} doc={doc} />
              <span className={`absolute top-1.5 left-1.5 font-mono text-2xs leading-none px-1.5 py-1 rounded-[6px] ${glass}`}>{time}</span>
              {first.kind && (
                <span className={`absolute top-1.5 right-1.5 w-[22px] h-[22px] rounded-[6px] grid place-items-center ${glass}`} aria-hidden="true">
                  <svg viewBox="0 0 12 12" className="w-3 h-3 fill-white">
                    {KIND_ICON[first.kind]}
                  </svg>
                </span>
              )}
              <span className="absolute left-1.5 right-1.5 bottom-1.5 flex items-center justify-between gap-1">
                {tile.items.some((i) => i.network) ? <Marks tile={tile} /> : <span />}
                {state !== 'queue' && !(many && state === 'error') && (
                  <span
                    className={`inline-flex items-center gap-1 text-2xs leading-none px-2 py-1 rounded-full before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full text-on-media backdrop-blur-[6px] ${
                      state === 'error' ? 'bg-[rgba(150,40,20,0.85)] before:bg-[rgb(255,170,150)]' : state === 'published' ? 'bg-[rgba(16,14,12,0.62)] before:bg-[rgb(160,225,140)]' : 'bg-[rgba(16,14,12,0.62)] before:bg-on-media'
                    }`}
                  >
                    {STATE[state]}
                  </span>
                )}
              </span>
            </span>
            <span className={`text-xs leading-snug line-clamp-2 px-0.5 ${caption ? 'text-ink' : 'text-muted italic'}`}>{caption || 'No caption'}</span>
            {many && failed.length > 0 && (
              <span className="font-mono text-3xs text-danger px-0.5 truncate">
                {failed.map(networkLabel).join(', ')} failed · {tile.items.length - failed.length} sent
              </span>
            )}
          </button>
        );
      })}
      {d.free.map((f) => (
        <span key={f.toISOString()} className="aspect-[4/5] rounded-paper border-[1.5px] border-dashed border-line flex flex-col items-center justify-center gap-0.5 text-muted">
          <span className="font-mono text-sm text-ink">{slotLabel(f, tz).split(' · ')[1]}</span>
          <span className="font-mono text-2xs">free</span>
        </span>
      ))}
    </div>
  );
}

function SendCard({
  tile,
  anchor,
  doc,
  tz,
  postiz,
  onClose,
  onOpen,
  onDelete,
}: {
  tile: PlannedTile;
  anchor: HTMLElement;
  doc: RecapDoc | undefined;
  tz: string;
  postiz: string;
  onClose: () => void;
  onOpen: (doc: RecapDoc) => void;
  onDelete: (items: PlannedItem[], doc: RecapDoc | undefined) => Promise<void>;
}) {
  const within = useRef<HTMLElement | null>(anchor);
  within.current = anchor;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const first = tile.items[0];
  const many = tile.items.length > 1;
  const failed = tile.items.filter((i) => i.state === 'error');
  // What can still be deleted in Postiz: everything that is not out.
  const live = tile.items.filter((i) => i.state !== 'published');
  const queued = live.filter((i) => i.state === 'queue');
  const verb = queued.length === live.length && live.length ? 'Take back' : 'Delete';
  const remove = async () => {
    setBusy(true);
    setFail(null);
    try {
      await onDelete(live, doc);
    } catch (err) {
      setFail(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setConfirm(false);
    }
  };
  const kind = first.kind ? (first.kind === 'reel' && tile.items.some((i) => i.trial) ? 'Trial Reel' : KIND[first.kind]) : null;
  const sendAgain = () => {
    if (!doc) return;
    // The recap opens on Export › Publish, only the networks that failed ticked.
    askSendAgain(
      doc.id,
      doc.publish.publications.filter((p) => failed.some((f) => f.postId === p.postId)).map((p) => p.channelId),
    );
    onOpen(doc);
  };
  const title = doc?.title ?? (first.title || 'No caption');
  return (
    <AnchoredPopover anchorRect={() => anchor.getBoundingClientRect()} onClose={onClose} within={within} role="dialog" label="The post" align="start" className="w-[17.5rem] p-0">
      <div className="grid grid-cols-[72px_1fr] gap-3 p-3 border-b border-line">
        <span className="relative block aspect-[4/5] rounded-[8px] overflow-hidden bg-paper-2">
          <Vignette tile={tile} doc={doc} />
        </span>
        <span className="flex flex-col gap-1 min-w-0">
          <b className={`text-sm font-semibold leading-snug break-words ${doc?.title || first.title ? 'text-ink' : 'italic text-muted font-normal'}`}>{title}</b>
          <span className="font-mono text-2xs leading-relaxed text-muted">
            {slotLabel(tile.at, tz)}
            <br />
            {[kind, many ? `${tile.items.length} networks` : STATE[first.state], doc ? null : 'from Postiz'].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>
      {many && (
        <ul className="m-0 px-3 py-2 list-none flex flex-col gap-1.5 border-b border-line" aria-label="Each network">
          {tile.items.map((i) => (
            <li key={i.postId} className="flex items-center gap-2 min-w-0 text-xs">
              <NetworkMark identifier={i.network ?? ''} size="xs" />
              <span className="flex-1 min-w-0 truncate text-ink-soft">{networkLabel(i)}</span>
              <span className={`font-mono text-2xs ${i.state === 'error' ? 'text-danger' : i.state === 'published' ? 'text-ok' : 'text-muted'}`}>{STATE[i.state]}</span>
              {i.state === 'published' && i.url && (
                <a href={i.url} target="_blank" rel="noreferrer" className="font-mono text-2xs text-accent-ink no-underline hover:underline" aria-label={`View on ${networkLabel(i)}`}>
                  view ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && (
        <div className="flex flex-col gap-1.5 px-3 py-2.5 bg-danger-wash border-b border-danger-line text-xs leading-snug">
          {failed.map((i) => {
            const hint = failureHint(i.error);
            return (
              <span key={i.postId} className="flex flex-col gap-0.5">
                <span className="text-danger">
                  {many ? `${networkLabel(i)}: ` : ''}
                  {(i.error ?? 'Postiz could not publish it.').split(/(?<=\.)\s/)[0]}
                </span>
                {hint && <span className="text-ink">{hint}</span>}
              </span>
            );
          })}
          {failed.some((i) => i.error) && (
            <button type="button" className="self-start p-0 border-0 bg-transparent font-mono text-2xs text-muted underline cursor-pointer" aria-expanded={raw} onClick={() => setRaw((r) => !r)}>
              {raw ? 'Hide what Postiz said' : 'What Postiz said'}
            </button>
          )}
          {raw && <span className="font-mono text-2xs text-muted whitespace-pre-wrap break-words">{failed.map((i) => `${many ? `${networkLabel(i)}: ` : ''}${i.error ?? ''}`).join('\n')}</span>}
        </div>
      )}
      <div className="flex flex-col p-1.5">
        {confirm ? (
          <div className="flex flex-col gap-1.5 p-1">
            <span className="text-xs text-ink-soft">
              {live.length > 1 ? `Delete its ${live.length} posts in your Postiz` : 'Delete it in your Postiz'}
              {queued.length ? ' before it goes out' : ''}?
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>
                {busy ? 'Deleting…' : verb}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
                Keep {live.length > 1 ? 'them' : 'it'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {failed.length > 0 && doc && (
              <Button size="sm" variant="primary" className="mb-1 justify-center" onClick={sendAgain} title="Opens the recap on Export › Publish, only what failed ticked">
                Send again{many ? ` to ${failed.map(networkLabel).join(', ')}` : ''}
              </Button>
            )}
            {doc && (
              <button type="button" className={ACT} onClick={() => onOpen(doc)}>
                {ACT_ICON.open}Open recap
              </button>
            )}
            {!many && first.state === 'published' && first.url && (
              <a href={first.url} target="_blank" rel="noreferrer" className={ACT}>
                {ACT_ICON.out}View on {networkLabel(first)}
              </a>
            )}
            {!doc && (
              <a href={postiz} target="_blank" rel="noreferrer" className={ACT}>
                {ACT_ICON.out}Open in Postiz
              </a>
            )}
            {live.length > 0 && (
              <button type="button" className={`${ACT} ${verb === 'Take back' ? '' : 'text-danger'}`} onClick={() => setConfirm(true)}>
                {verb === 'Take back' ? ACT_ICON.back : ACT_ICON.del}
                {verb}
                {many && live.length < tile.items.length ? ` what is not out` : ''}
              </button>
            )}
          </>
        )}
        {fail && <span className="text-xs text-danger p-1">{fail}</span>}
      </div>
    </AnchoredPopover>
  );
}

/** A card's verb (lab 15): a full-width row with its glyph, 40 px high. */
const ACT =
  'flex items-center gap-2.5 min-h-10 px-2.5 rounded-[8px] border-0 bg-transparent text-ink text-sm font-medium text-left no-underline cursor-pointer hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-accent';
const glyph = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" className="w-[15px] h-[15px] flex-none fill-none stroke-current [stroke-width:1.8]" aria-hidden="true">
    {d}
  </svg>
);
const ACT_ICON = {
  open: glyph(
    <>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 6h6M5 9h4" />
    </>,
  ),
  back: glyph(
    <>
      <path d="M6 4L2.5 7.5 6 11" />
      <path d="M3 7.5h7a3.5 3.5 0 010 7H8" />
    </>,
  ),
  out: glyph(
    <>
      <path d="M9 3h4v4M13 3L7 9" />
      <path d="M11 9.5V13H3V5h3.5" />
    </>,
  ),
  del: glyph(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />),
};
