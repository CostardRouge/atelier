import { useEffect, useMemo, useState } from 'react';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import { plannedPeek, plannedWeeks, sameDayClash, type PlannedItem } from '../../shared/recap/recap-planned';
import { PostizClient, type PostizPost } from '../../shared/sources/postiz/client';
import { slotLabel } from '../../shared/sources/postiz/rhythm';
import { usePostiz } from '../../shared/sources/postiz/use-postiz';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { GallerySection } from './GallerySections';
import { getThumb } from './recap-store';

const KIND: Record<string, string> = { reel: 'Reel', carousel: 'Carousel', story: 'Story' };
const STATE: Record<PlannedItem['state'], string> = { queue: 'scheduled', published: 'out', error: 'failed', draft: 'draft in Postiz' };
const DAY = 86400000;

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
  return url ? <img src={url} alt="" className="w-[30px] h-[38px] rounded-[4px] object-cover flex-none" /> : <span className="w-[30px] h-[38px] rounded-[4px] bg-surface border border-line flex-none" aria-hidden="true" />;
}

/**
 * The gallery's *Planned* (lab 12): what goes out on his Instagram, week by
 * week, as his Postiz says — scheduled, out, failed — each post a recap sent
 * opens. Only where a Postiz is connected; read when the gallery opens.
 */
export default function PlannedSection({ recaps, open, onToggle, onOpen }: { recaps: readonly RecapDoc[]; open: boolean; onToggle: () => void; onOpen: (doc: RecapDoc) => void }) {
  const conn = usePostiz();
  const [posts, setPosts] = useState<PostizPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!conn) return;
    let alive = true;
    const now = Date.now();
    new PostizClient(conn.apiBase, conn.apiKey)
      .posts(new Date(now - 7 * DAY), new Date(now + 42 * DAY))
      .then((p) => alive && (setPosts(p), setError(null)))
      .catch((err: unknown) => alive && (setError(err instanceof Error ? err.message : String(err)), setPosts([])));
    return () => {
      alive = false;
    };
  }, [conn?.apiBase, conn?.apiKey]);
  const tz = conn?.rhythm.timeZone ?? 'Europe/Paris';
  const weeks = useMemo(() => plannedWeeks(posts ?? [], recaps, tz), [posts, recaps, tz]);
  if (!conn) return null;
  const byId = new Map(recaps.map((d) => [d.id, d]));
  const count = weeks.reduce((n, w) => n + w.items.length, 0);
  const label = (d: Date) => slotLabel(d, tz);
  return (
    <GallerySection
      id="planned"
      title="Planned"
      count={posts === null ? null : count}
      hot={weeks.some((w) => w.items.some((i) => i.state === 'error'))}
      open={open}
      onToggle={onToggle}
      peek={<span className="text-xs text-muted whitespace-nowrap overflow-hidden text-ellipsis">{posts === null ? 'asking your Postiz…' : plannedPeek(weeks, tz, new Date(), label)}</span>}
    >
      {error && <p className="m-0 mb-2 text-xs text-warn">{error}</p>}
      {posts !== null && !weeks.length && <p className="m-0 text-sm text-muted">Nothing goes out in the next six weeks. A recap&apos;s Export tab schedules one.</p>}
      <div className="flex flex-col">
        {weeks.map((w) => (
          <div key={w.monday} className="grid grid-cols-1 sm:grid-cols-[7rem_1fr] gap-2 sm:gap-3 py-2.5 border-b border-line last:border-b-0">
            <span className="font-mono text-2xs text-muted pt-1">
              week of {Number(w.monday.slice(8))} {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(w.monday.slice(5, 7)) - 1]}
              {sameDayClash(w, tz) && <span className="block text-warn">two the same day</span>}
            </span>
            <div className="flex flex-wrap gap-2 min-w-0">
              {w.items.map((i) => {
                const doc = i.recapId ? byId.get(i.recapId) : undefined;
                const tone = i.state === 'error' ? 'text-danger' : i.state === 'published' ? 'text-ok' : i.state === 'queue' ? 'text-accent-ink' : 'text-muted';
                const body = (
                  <>
                    <Thumb recapId={doc ? doc.id : null} />
                    <span className="flex flex-col min-w-0 text-left">
                      <span className="text-xs text-ink truncate max-w-[14rem]">{i.title}</span>
                      <span className={`font-mono text-2xs ${tone}`}>
                        {[i.kind ? KIND[i.kind] + (i.trial ? ' · trial' : '') : null, STATE[i.state], label(i.at)].filter(Boolean).join(' · ')}
                      </span>
                      {i.error && <span className="text-2xs text-danger truncate max-w-[14rem]" title={i.error}>{i.error}{doc ? ' — open to send it again' : ''}</span>}
                    </span>
                  </>
                );
                const cls = 'flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-paper border border-line bg-surface min-w-0';
                return doc ? (
                  <button key={i.postId} type="button" onClick={() => onOpen(doc)} className={`${cls} cursor-pointer hover:border-accent`}>
                    {body}
                  </button>
                ) : i.url ? (
                  <a key={i.postId} href={i.url} target="_blank" rel="noreferrer" className={`${cls} no-underline hover:border-accent`}>
                    {body}
                  </a>
                ) : (
                  <span key={i.postId} className={cls}>
                    {body}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </GallerySection>
  );
}
