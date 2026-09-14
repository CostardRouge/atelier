import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { isRawImage, type Asset } from '../../shared/library/assets';
import { useObjectUrls } from '../../shared/lib/use-object-urls';
import { hashedMediaRef, knownIdentity } from '../../shared/projects/media-identity';
import { readCapture, isoFromTimestamp } from '../../shared/roadtrip/media-date';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import type { HookContext, HookPickedPicture } from '../../shared/roadtrip/hooks/hook-variant';
import {
  defaultSpan,
  groupByDay,
  inSpan,
  initialExclusions,
  mergePool,
  quickSpans,
  reachSpan,
  type DateSpan,
  type PoolCandidate,
} from '../../shared/roadtrip/hooks/picture-pool';
import type { WinnowAssetRow, WinnowClient } from '../../shared/sources/winnow/client';
import { captureMtime } from '../../shared/sources/winnow/materialize';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import { useScopeRows } from '../../shared/sources/winnow/use-scope-rows';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import Button from '../../shared/ui/Button';
import { DateField } from '../../shared/ui/DateField';
import MediaLightbox, { type LightboxItem } from '../../shared/ui/MediaLightbox';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

/** A candidate, and what draws its tile and finds its bytes. */
type Candidate = PoolCandidate &
  ({ origin: 'library'; asset: Asset; file: File } | { origin: 'instance'; row: WinnowAssetRow });

interface HookPicturesModalProps {
  /** The calendar, the piece's day and the legs — what the spans are made of. */
  ctx: HookContext;
  /** What the variant holds now; ticked on open. */
  selected: readonly HookPickedPicture[];
  /**
   * Open on the piece's own day as well as the days before it — what a variant
   * whose pictures are not a run-up to the piece asks for (`defaultSpan`).
   */
  includeThisDay?: boolean;
  onCancel: () => void;
  onConfirm: (picked: HookPickedPicture[]) => void;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Each Library file's capture day and position, read once per File for the
 * whole session: reopening the chooser must not re-read a hundred EXIF heads.
 */
const captures = new WeakMap<File, { date: string | null; coords: { lat: number; lon: number } | null }>();

/**
 * The Library's photographs with the day each was shot — and where, when the
 * file says — read from their heads, a few at a time, so the grid fills as
 * the dates come in.
 */
function useLibraryCandidates(assets: readonly Asset[]): { items: Candidate[]; reading: number } {
  const photos = useMemo(
    () =>
      assets.flatMap((asset) => {
        const file = asset.parts.image;
        return file && !isRawImage(file.name) ? [{ asset, file }] : [];
      }),
    [assets],
  );
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const unread = photos.filter(({ file }) => !captures.has(file));
    if (!unread.length) return;
    void (async () => {
      const queue = [...unread];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const capture = await readCapture(next.file);
          captures.set(next.file, { date: capture.date?.date ?? null, coords: capture.coords });
          if (cancelled) return;
        }
      };
      // Four heads at a time, repainting after every batch of reads.
      const tick = window.setInterval(() => setGeneration((g) => g + 1), 250);
      await Promise.all([worker(), worker(), worker(), worker()]);
      window.clearInterval(tick);
      if (!cancelled) setGeneration((g) => g + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  return useMemo(() => {
    let reading = 0;
    const items: Candidate[] = [];
    for (const { asset, file } of photos) {
      const capture = captures.get(file);
      if (!capture) {
        reading += 1;
        continue;
      }
      const { date, coords } = capture;
      if (!date) continue;
      const identity = knownIdentity(file);
      items.push({
        key: `lib:${asset.id}`,
        origin: 'library',
        asset,
        file,
        date,
        takenAt: file.lastModified,
        ...(coords ? { coords } : {}),
        ref: {
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          ...(identity?.assetId ? { assetId: identity.assetId } : {}),
          ...(identity?.hash ? { hash: identity.hash } : {}),
        },
      });
    }
    return { items, reading };
    // `generation` is how the dates read in the background reach this list.
  }, [photos, generation]);
}

function rowCandidate(row: WinnowAssetRow, host: string): Candidate | null {
  if (row.media_type !== 'photo') return null;
  const mtime = captureMtime(row);
  const day = row.capture_date?.slice(0, 10);
  const date = day && ISO_DAY.test(day) ? day : isoFromTimestamp(mtime);
  if (!date) return null;
  // The instance parsed the picture's EXIF at ingest; its position is the
  // same column the exposure elements already read (`exif-from-row.ts`).
  const located =
    typeof row.gps_lat === 'number' &&
    typeof row.gps_lon === 'number' &&
    Number.isFinite(row.gps_lat) &&
    Number.isFinite(row.gps_lon);
  return {
    key: `win:${host}/${row.id}`,
    origin: 'instance',
    row,
    date,
    takenAt: mtime,
    ...(located ? { coords: { lat: row.gps_lat as number, lon: row.gps_lon as number } } : {}),
    ref: {
      name: row.filename,
      size: row.file_size ?? 0,
      lastModified: mtime,
      assetId: `${host}/${row.id}`,
      ...(row.content_hash ? { hash: row.content_hash } : {}),
    },
  };
}

/**
 * Choosing the pictures a Défilé flashes — the maintainer's own gesture: show
 * what was shot over a span of the trip, take it all at once, untick what does
 * not belong.
 *
 * - **What is offered** is what was SHOT in the span, wherever it is kept:
 *   the Library's photographs, dated from their EXIF, and — when an instance
 *   is connected — what it holds for those days, asked once per span. The
 *   same picture in both is offered once (`picture-pool.ts`).
 * - **Nothing is fetched to choose.** The instance's tiles are its thumbnails;
 *   a picture's bytes are fetched only when the sweep draws it, at the
 *   editing rendition, and never land in the Library.
 * - **Photos only.** A clip's frame would mean downloading the clip; a picked
 *   clip is a promise the sweep cannot keep, so none is offered and the grid
 *   says how many were left out.
 *
 * A viewport-sized sheet with one scrolling grid, full screen under 820px
 * (`frontend.md`). Rendered through a portal: it opens from inside the
 * inspector, which is a sheet of its own on a phone.
 */
export default function HookPicturesModal({
  ctx,
  selected,
  includeThisDay = false,
  onCancel,
  onConfirm,
}: HookPicturesModalProps) {
  const lib = useAssetLibrary();
  const { connection, client } = useWinnowConnection();
  const calendar = useMemo(() => ctx.calendar ?? [], [ctx.calendar]);
  const reach = reachSpan(calendar, ctx.date);
  const [span, setSpan] = useState<DateSpan | null>(() =>
    defaultSpan(calendar, ctx.date, selected, includeThisDay),
  );
  const quick = useMemo(() => quickSpans(calendar, ctx.date, ctx.stages), [calendar, ctx.date, ctx.stages]);

  const library = useLibraryCandidates(lib.assets);
  const scope = useScopeRows(client, connection?.id ?? null, span?.from ?? null, span?.to ?? null, !!connection);
  const instance = useMemo(
    () =>
      connection && scope.rows
        ? scope.rows.flatMap((row) => rowCandidate(row, connection.id) ?? [])
        : [],
    [scope.rows, connection],
  );
  const clipsLeftOut = scope.rows?.filter((row) => row.media_type === 'video').length ?? 0;

  const pool = useMemo(
    () => (span ? inSpan(mergePool(library.items, instance), span) : []),
    [library.items, instance, span],
  );
  const groups = useMemo(() => groupByDay(pool, calendar), [pool, calendar]);

  // Unticked, by key. Every candidate is decided the first time it is SEEN:
  // taken, unless the variant already held a list that does not name it — and
  // only for the span the chooser opened on. A span the author widens is new
  // ground, and new ground is taken whole.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const seen = useRef(new Set<string>());
  const openingSpan = useRef(true);
  useEffect(() => {
    const fresh = pool.filter((c) => !seen.current.has(c.key));
    if (!fresh.length) return;
    for (const c of fresh) seen.current.add(c.key);
    if (!openingSpan.current || !selected.length) return;
    const skip = initialExclusions(fresh, selected);
    if (skip.size) setExcluded((prev) => new Set([...prev, ...skip]));
  }, [pool, selected]);

  const changeSpan = (next: DateSpan) => {
    openingSpan.current = false;
    setSpan(next);
  };

  const ticked = pool.filter((c) => !excluded.has(c.key));
  const toggle = (keys: readonly string[], on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.delete(key);
        else next.add(key);
      }
      return next;
    });

  // Ask the Library for the thumbnails of what is on offer.
  useEffect(() => {
    for (const c of pool) if (c.origin === 'library') lib.ensureMeta(c.asset.id);
  }, [pool, lib]);

  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // A Library file's content hash is what finds it again once it is
      // renamed or re-exported; it is read for the kept pictures only.
      const picked = await Promise.all(
        ticked.map(async (c): Promise<HookPickedPicture> => ({
          ref: c.origin === 'library' ? await hashedMediaRef(c.file) : c.ref,
          date: c.date,
          takenAt: c.takenAt,
          ...(c.coords ? { coords: c.coords } : {}),
        })),
      );
      onConfirm(picked);
    } finally {
      setBusy(false);
    }
  };

  // Looking at one, large.
  const [looking, setLooking] = useState<number | null>(null);
  useDialogKeys({
    onCancel: looking === null ? onCancel : undefined,
    onConfirm: looking === null && !busy ? () => void confirm() : null,
  });

  const loading = library.reading > 0 || (connection !== null && scope.rows === null);
  const where = connection ? `the Library or on ${connection.id}` : 'the Library';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Pictures for the sweep"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[60rem] h-[min(90dvh,52rem)] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 pb-5 min-h-0 max-[820px]:max-w-none max-[820px]:h-[var(--app-h,100dvh)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:px-4 max-[820px]:pt-[max(1rem,env(safe-area-inset-top))] max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div>
          <h2 className="m-0 font-serif text-2xl">Pictures for the sweep</h2>
          <p className="m-0 mt-1 text-sm text-muted">
            Everything shot over these days in {where}. All of it is taken — untick what does
            not belong. The sweep shows them in the order they were shot.
          </p>
        </div>

        {span && reach ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 max-w-[26rem]">
              <DateField
                label="From"
                value={span.from}
                min={reach.from}
                max={span.to}
                format={formatIsoDate}
                onChange={(from) => ISO_DAY.test(from) && changeSpan({ from, to: span.to < from ? from : span.to })}
              />
              <span className="text-sm text-muted" aria-hidden="true">
                →
              </span>
              <DateField
                label="To"
                value={span.to}
                min={span.from}
                max={reach.to}
                format={formatIsoDate}
                onChange={(to) => ISO_DAY.test(to) && changeSpan({ from: span.from > to ? to : span.from, to })}
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Quick spans">
              {quick.map((q) => {
                const on = q.from === span.from && q.to === span.to;
                return (
                  <button
                    key={q.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => changeSpan({ from: q.from, to: q.to })}
                    className={`px-2.5 py-1 rounded-full border text-xs cursor-pointer transition-colors ${
                      on ? 'border-accent bg-accent-wash text-ink' : 'border-line bg-paper text-ink-soft hover:border-line-strong'
                    }`}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="m-0 text-sm text-danger">This piece is dated outside its trip — there are no days to choose from.</p>
        )}

        <div className="flex items-center gap-3 flex-wrap border-t border-line pt-3">
          <span className="font-mono text-2xs tracking-[0.12em] uppercase text-muted">
            {ticked.length} of {pool.length} {pool.length === 1 ? 'photo' : 'photos'}
          </span>
          <button
            type="button"
            onClick={() => toggle(pool.map((c) => c.key), true)}
            className="font-mono text-3xs tracking-[0.1em] uppercase text-muted hover:text-accent cursor-pointer"
          >
            all
          </button>
          <button
            type="button"
            onClick={() => toggle(pool.map((c) => c.key), false)}
            className="font-mono text-3xs tracking-[0.1em] uppercase text-muted hover:text-accent cursor-pointer"
          >
            none
          </button>
          {loading && (
            <span className="font-mono text-2xs text-muted">
              {library.reading > 0 ? `reading ${library.reading} dates…` : `asking ${connection?.id}…`}
            </span>
          )}
          {clipsLeftOut > 0 && (
            <span className="text-xs text-faint">
              {clipsLeftOut} {clipsLeftOut === 1 ? 'clip' : 'clips'} left out — photos only
            </span>
          )}
        </div>

        {scope.problem && (
          <p className="m-0 -mt-2 text-xs text-danger" role="alert">
            {scope.problem.text}{' '}
            {scope.problem.login && (
              <a className="font-semibold underline underline-offset-[3px]" href={scope.problem.login} target="_blank" rel="noreferrer">
                Sign in there
              </a>
            )}
          </p>
        )}

        <div className="flex-1 min-h-0 overflow-auto pr-1 -mr-1">
          {groups.length === 0 ? (
            <p className="m-0 text-sm text-muted">
              {loading
                ? 'Looking…'
                : `Nothing shot between ${span ? formatIsoDate(span.from) : '—'} and ${span ? formatIsoDate(span.to) : '—'} in ${where}.`}
              {!connection && !loading && ' Connect a Winnow on Sources to see what it holds for these days.'}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => {
                const keys = group.items.map((c) => c.key);
                const allOn = keys.every((key) => !excluded.has(key));
                return (
                  <section key={group.date} className="flex flex-col gap-2" aria-label={formatIsoDate(group.date)}>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-ink">
                        {group.day ? `Day ${group.day.dayNumber}` : formatIsoDate(group.date)}
                      </span>
                      {group.day && <span className="text-xs text-muted">{formatIsoDate(group.date)}</span>}
                      <span className="text-xs text-faint">
                        {keys.filter((key) => !excluded.has(key)).length}/{keys.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(keys, !allOn)}
                        className="font-mono text-3xs tracking-[0.1em] uppercase text-muted hover:text-accent cursor-pointer"
                      >
                        {allOn ? 'none' : 'all'}
                      </button>
                    </div>
                    {/* Pixel rows, never `auto` or `aspect-*`: a grid tile's
                        height must not be a share of anything (`frontend.md`). */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] auto-rows-[112px] gap-1.5 max-[820px]:grid-cols-[repeat(auto-fill,minmax(96px,1fr))] max-[820px]:auto-rows-[108px]">
                      {group.items.map((c) => (
                        <Tile
                          key={c.key}
                          candidate={c}
                          on={!excluded.has(c.key)}
                          client={client}
                          thumbUrl={c.origin === 'library' ? lib.meta.get(c.asset.id)?.thumbUrl : undefined}
                          onToggle={() => toggle([c.key], excluded.has(c.key))}
                          onLook={() => setLooking(pool.indexOf(c))}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 gap-y-2 flex-wrap border-t border-line pt-4">
          <p className="m-0 text-xs text-muted grow shrink basis-[20rem] min-w-0">
            {selected.length > 0
              ? 'Only what is ticked in these days is kept.'
              : 'Nothing is downloaded to choose: a picture is fetched when the sweep draws it.'}
          </p>
          <div className="flex items-center gap-3 ml-auto">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void confirm()} disabled={busy || !span}>
              {busy ? 'Keeping…' : ticked.length === 0 ? 'Use no picture' : `Use ${ticked.length} ${ticked.length === 1 ? 'picture' : 'pictures'}`}
            </Button>
          </div>
        </div>
      </div>

      {looking !== null && pool[looking] && (
        <Look
          pool={pool}
          index={looking}
          onIndex={setLooking}
          onClose={() => setLooking(null)}
          client={client}
          from={connection ? `from the Library and ${connection.id}` : 'from the Library'}
          thumbFor={(c) => (c.origin === 'library' ? lib.meta.get(c.asset.id)?.thumbUrl : undefined)}
          on={!excluded.has(pool[looking].key)}
          onToggle={() => toggle([pool[looking].key], excluded.has(pool[looking].key))}
        />
      )}
    </div>,
    document.body,
  );
}

/**
 * One picture on offer: the whole tile ticks and unticks it, the corner looks
 * at it large — the picker grammar the suite settled on (`frontend.md`).
 */
function Tile({
  candidate,
  on,
  client,
  thumbUrl,
  onToggle,
  onLook,
}: {
  candidate: Candidate;
  on: boolean;
  client: WinnowClient | null;
  thumbUrl: string | undefined;
  onToggle: () => void;
  onLook: () => void;
}) {
  return (
    <div
      className={`relative rounded-md overflow-hidden border bg-frame ${
        on ? 'border-accent shadow-[inset_0_0_0_2px_var(--color-accent)]' : 'border-line'
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={`${on ? 'Leave out' : 'Take'} ${candidate.ref.name}`}
        onClick={onToggle}
        className="absolute inset-0 w-full h-full p-0 border-0 bg-transparent cursor-pointer"
      >
        {candidate.origin === 'instance' && client ? (
          <WinnowThumb client={client} id={candidate.row.id} alt="" label="photo" box={`w-full h-full ${on ? '' : 'opacity-45'}`} />
        ) : thumbUrl ? (
          <img src={thumbUrl} alt="" className={`block w-full h-full object-cover ${on ? '' : 'opacity-45'}`} draggable={false} />
        ) : (
          <span className="grid place-items-center w-full h-full font-mono text-3xs text-white/60">photo</span>
        )}
      </button>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1.5 top-1.5 grid place-items-center w-[18px] h-[18px] rounded-[4px] border text-2xs leading-none ${
          on ? 'bg-accent border-accent text-white' : 'bg-black/35 border-white/70 text-transparent'
        }`}
      >
        ✓
      </span>
      <button
        type="button"
        onClick={onLook}
        aria-label={`Look at ${candidate.ref.name}`}
        className="absolute right-1 top-1 grid place-items-center w-6 h-6 rounded-[5px] bg-black/45 text-white text-xs border-0 cursor-pointer hover:bg-black/70 max-[820px]:w-8 max-[820px]:h-8"
      >
        ⤢
      </button>
      <span className="pointer-events-none absolute bottom-0 inset-x-0 px-1.5 py-0.5 font-mono text-3xs text-paper bg-[rgba(20,18,15,0.62)] truncate">
        {candidate.origin === 'instance' ? '◇ ' : ''}
        {candidate.ref.name}
      </span>
    </div>
  );
}

/** The pool, large, one at a time — with the tick in the footer. */
function Look({
  pool,
  index,
  onIndex,
  onClose,
  client,
  from,
  thumbFor,
  on,
  onToggle,
}: {
  pool: readonly Candidate[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  client: WinnowClient | null;
  from: string;
  thumbFor: (c: Candidate) => string | undefined;
  on: boolean;
  onToggle: () => void;
}) {
  // Object URLs for the open picture and its neighbours only.
  const window_ = useMemo(() => {
    const files = new Map<string, File>();
    for (let d = -2; d <= 2; d += 1) {
      const c = pool[index + d];
      if (c?.origin === 'library') files.set(c.key, c.file);
    }
    return files;
  }, [pool, index]);
  const urls = useObjectUrls(window_);
  const items = useMemo<LightboxItem[]>(
    () =>
      pool.map((c) => ({
        id: c.key,
        title: c.ref.name,
        facts: formatIsoDate(c.date),
        kind: 'photo',
        src: c.origin === 'instance' ? (client?.proxyUrl(c.row.id) ?? null) : (urls.get(c.key) ?? null),
        still: c.origin === 'instance' ? (client?.thumbUrl(c.row.id) ?? null) : (thumbFor(c) ?? null),
        natural:
          c.origin === 'instance' && c.row.width && c.row.height ? { width: c.row.width, height: c.row.height } : null,
        credentialed: c.origin === 'instance',
      })),
    [pool, client, urls, thumbFor],
  );
  return (
    <MediaLightbox
      items={items}
      index={index}
      onIndex={onIndex}
      onClose={onClose}
      from={from}
      onConfirm={onToggle}
      footer={
        <Button variant={on ? 'default' : 'primary'} size="sm" onClick={onToggle}>
          {on ? '✓ Taken — leave it out' : 'Take this picture'}
        </Button>
      }
    />
  );
}
