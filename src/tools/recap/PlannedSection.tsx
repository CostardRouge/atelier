import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { mondayOf, plannedPeek, plannedWeeks, weekLabel, weekStrip, type PlannedItem, type StripDay } from '../../shared/recap/recap-planned';
import { PostizClient, failureHint, postizHome, type PostizPost } from '../../shared/sources/postiz/client';
import { slotLabel } from '../../shared/sources/postiz/rhythm';
import { usePostiz } from '../../shared/sources/postiz/use-postiz';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { AnchoredPopover } from '../../shared/ui/OverflowMenu';
import Button, { buttonClass } from '../../shared/ui/Button';
import { GallerySection } from './GallerySections';
import { getThumb, putRecap } from './recap-store';

const KIND: Record<string, string> = { reel: 'Reel', carousel: 'Carousel', story: 'Story' };
const STATE: Record<PlannedItem['state'], string> = { queue: 'scheduled', published: 'out', error: 'failed', draft: 'draft' };
const EDGE: Record<PlannedItem['state'], string> = { queue: 'border-l-accent', published: 'border-l-ok', error: 'border-l-danger', draft: 'border-l-line-strong' };
const DAY = 86400000;
/** How far the strip can go: what is read from Postiz once, when the gallery opens. */
const BACK_WEEKS = 5;
const AHEAD_WEEKS = 8;

/** The editor opens on this tab for that recap — *Send again* lands on Export › Publish. */
export const OPEN_TAB_KEY = 'atelier.recap.openTab';

function Thumb({ recapId }: { recapId: string | null }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let alive = true;
    if (recapId) void getThumb(recapId).then((b) => alive && setBlob(b));
    return () => {
      alive = false;
    };
  }, [recapId]);
  const url = useObjectUrl(blob);
  if (url) return <img src={url} alt="" className="w-[26px] h-[32px] rounded-[4px] object-cover flex-none" />;
  return (
    <span className="w-[26px] h-[32px] rounded-[4px] border border-dashed border-line flex-none grid place-items-center font-mono text-3xs text-muted" aria-hidden="true">
      {recapId ? '' : 'PZ'}
    </span>
  );
}

/**
 * The gallery's *Planned* (lab 14, his pick: «une bande par semaine»): one
 * week of seven days — what went out, what will, what failed, and the
 * rhythm's slots still free — scrolling sideways on a phone, today first.
 * Atelier makes and sends; the whole calendar is Postiz's, one link away.
 * A post is a button (lab 14's A): it opens a small card with what it is, a
 * failure's reason and what to do, and the verbs of its state.
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
  const [active, setActive] = useState<{ item: PlannedItem; el: HTMLElement } | null>(null);
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

  // On a phone the strip overflows: today is brought to its left edge, never the page scrolled.
  const strip = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    const today = el?.querySelector<HTMLElement>('[data-today="true"]');
    if (el && today && el.scrollWidth > el.clientWidth) el.scrollLeft = today.offsetLeft - el.offsetLeft;
  }, [open, offset, posts]);

  if (!conn) return null;
  const byId = new Map(recaps.map((d) => [d.id, d]));
  const inWeek = days.reduce((n, d) => n + d.items.length, 0);
  const failed = weeks.some((w) => w.items.some((i) => i.state === 'error'));
  return (
    <GallerySection
      id="planned"
      title="Planned"
      count={posts === null ? null : inWeek}
      hot={failed}
      open={open}
      onToggle={onToggle}
      peek={<span className="text-xs text-muted whitespace-nowrap overflow-hidden text-ellipsis">{posts === null ? 'asking your Postiz…' : plannedPeek(weeks, tz, now, (d) => slotLabel(d, tz))}</span>}
      actions={
        <a href={postizHome(conn.apiBase)} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')} title="The whole calendar, in your Postiz">
          Open Postiz ↗
        </a>
      }
    >
      <div className="flex items-center gap-1 mb-2">
        <button type="button" className={buttonClass('ghost', 'sm')} aria-label="Previous week" disabled={offset <= -BACK_WEEKS} onClick={() => setOffset((o) => o - 1)}>
          ‹
        </button>
        <span className="font-mono text-2xs text-muted tabular-nums min-w-[7.5rem] text-center">{weekLabel(monday)}</span>
        <button type="button" className={buttonClass('ghost', 'sm')} aria-label="Next week" disabled={offset >= AHEAD_WEEKS} onClick={() => setOffset((o) => o + 1)}>
          ›
        </button>
        {offset !== 0 && (
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setOffset(0)}>
            This week
          </button>
        )}
      </div>
      {error && <p className="m-0 mb-2 text-xs text-warn">{error}</p>}
      <div ref={strip} className="grid grid-flow-col auto-cols-[minmax(7.5rem,1fr)] gap-1.5 overflow-x-auto snap-x snap-mandatory pb-1" role="list" aria-label={`The week of ${weekLabel(monday)}`}>
        {days.map((d) => (
          <Day key={d.day} d={d} tz={tz} byId={byId} onPick={(item, el) => setActive((cur) => (cur?.item.postId === item.postId ? null : { item, el }))} />
        ))}
      </div>
      {active && (
        <PostCard
          item={active.item}
          anchor={active.el}
          doc={active.item.recapId ? byId.get(active.item.recapId) : undefined}
          tz={tz}
          postiz={postizHome(conn.apiBase)}
          onClose={() => setActive(null)}
          onOpen={onOpen}
          onDelete={async (item, doc) => {
            await client!.deletePost(item.postId);
            if (doc) {
              await putRecap(withRecap(doc, { publish: { ...doc.publish, publications: doc.publish.publications.filter((p) => p.postId !== item.postId) } }));
              onChanged();
            }
            setActive(null);
            await load();
          }}
        />
      )}
    </GallerySection>
  );
}

function Day({ d, tz, byId, onPick }: { d: StripDay; tz: string; byId: Map<string, RecapDoc>; onPick: (item: PlannedItem, el: HTMLElement) => void }) {
  return (
    <div
      role="listitem"
      data-today={d.today}
      className={`snap-start min-h-[8.25rem] min-w-0 flex flex-col gap-1.5 p-1.5 rounded-paper border ${d.today ? 'border-accent shadow-[inset_0_2px_0_var(--color-accent)]' : 'border-line'} ${d.past ? 'bg-transparent' : 'bg-surface'}`}
    >
      <span className="flex justify-between font-mono text-3xs tracking-[0.1em] uppercase text-muted px-0.5">
        <span>{d.label}</span>
        {d.today && <span className="text-accent-ink">today</span>}
      </span>
      {d.items.map((i) => {
        const doc = i.recapId ? byId.get(i.recapId) : undefined;
        return (
          <button
            key={i.postId}
            type="button"
            aria-haspopup="dialog"
            onClick={(e) => onPick(i, e.currentTarget)}
            className={`grid grid-cols-[26px_1fr] gap-1.5 items-start text-left p-1.5 pl-2 rounded-[7px] border border-transparent border-l-[3px] ${EDGE[i.state]} ${i.state === 'error' ? 'bg-danger-wash' : 'bg-paper-2'} hover:border-line-strong cursor-pointer min-w-0`}
          >
            <Thumb recapId={doc ? doc.id : null} />
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className={`text-xs leading-snug line-clamp-2 ${i.title ? 'text-ink' : 'text-muted italic'}`}>{i.title || 'No caption'}</span>
              <span className={`font-mono text-3xs leading-tight ${i.state === 'error' ? 'text-danger' : 'text-muted'}`}>
                {slotLabel(i.at, tz).split(' · ')[1]} · {i.kind ? KIND[i.kind] + (i.trial ? ' trial' : '') : 'Postiz'} · {STATE[i.state]}
              </span>
            </span>
          </button>
        );
      })}
      {d.free.map((f) => (
        <span key={f.toISOString()} className="rounded-[7px] border border-dashed border-line px-1.5 py-1 font-mono text-3xs text-muted">
          {slotLabel(f, tz).split(' · ')[1]} · free
        </span>
      ))}
    </div>
  );
}

function PostCard({
  item,
  anchor,
  doc,
  tz,
  postiz,
  onClose,
  onOpen,
  onDelete,
}: {
  item: PlannedItem;
  anchor: HTMLElement;
  doc: RecapDoc | undefined;
  tz: string;
  postiz: string;
  onClose: () => void;
  onOpen: (doc: RecapDoc) => void;
  onDelete: (item: PlannedItem, doc: RecapDoc | undefined) => Promise<void>;
}) {
  const within = useRef<HTMLElement | null>(anchor);
  within.current = anchor;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const hint = failureHint(item.error);
  const remove = async () => {
    setBusy(true);
    setFail(null);
    try {
      await onDelete(item, doc);
    } catch (err) {
      setFail(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const verb = item.state === 'queue' ? 'Take back' : 'Delete';
  return (
    <AnchoredPopover anchorRect={() => anchor.getBoundingClientRect()} onClose={onClose} within={within} role="dialog" label="The post" align="start" className="w-[17rem] p-2">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5 px-1 pb-2 border-b border-line">
          <b className={`text-sm font-semibold leading-snug ${item.title ? '' : 'italic text-muted font-normal'}`}>{doc?.title ?? (item.title || 'No caption')}</b>
          <span className="font-mono text-2xs text-muted">
            {slotLabel(item.at, tz)} · {item.kind ? KIND[item.kind] + (item.trial ? ' · trial' : '') : 'from Postiz'} · {STATE[item.state]}
          </span>
          {item.state === 'error' && (
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-xs text-danger leading-snug">{(item.error ?? 'Postiz could not publish it.').split(/(?<=\.)\s/)[0]}</span>
              {hint && <span className="text-xs text-ink-soft leading-snug">{hint}</span>}
              {item.error && (
                <button type="button" className="self-start p-0 border-0 bg-transparent font-mono text-2xs text-muted underline cursor-pointer" aria-expanded={raw} onClick={() => setRaw((r) => !r)}>
                  {raw ? 'Hide what Postiz said' : 'What Postiz said'}
                </button>
              )}
              {raw && <span className="font-mono text-2xs text-muted leading-snug whitespace-pre-wrap break-words">{item.error}</span>}
            </div>
          )}
        </div>
        {confirm ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-ink-soft px-1">{item.state === 'queue' ? 'Delete it in your Postiz before it goes out?' : 'Delete it in your Postiz?'}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>
                {busy ? 'Deleting…' : verb}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {item.state === 'error' && doc && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  try {
                    sessionStorage.setItem(OPEN_TAB_KEY, `${doc.id}:export`);
                  } catch {
                    // The editor then opens on its own tab.
                  }
                  onOpen(doc);
                }}
                title="Opens the recap on Export › Publish, the same post ready to send again"
              >
                Send again
              </Button>
            )}
            {doc && item.state !== 'error' && (
              <Button size="sm" variant="ghost" onClick={() => onOpen(doc)}>
                Open recap
              </Button>
            )}
            {item.state === 'published' && item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
                View on Instagram ↗
              </a>
            )}
            {!doc && (
              <a href={postiz} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
                Open in Postiz ↗
              </a>
            )}
            {item.state !== 'published' && (
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                {verb}
              </Button>
            )}
          </div>
        )}
        {fail && <span className="text-xs text-danger px-1">{fail}</span>}
      </div>
    </AnchoredPopover>
  );
}
