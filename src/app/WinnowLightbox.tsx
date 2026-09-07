import { useCallback, useEffect, useState } from 'react';
import type { WinnowAssetRow, WinnowClient } from '../shared/sources/winnow/client';
import type { WinnowConnection } from '../shared/sources/winnow/store';
import type { InstancePicker } from '../shared/sources/winnow/use-pick';
import { exifTimestampFromIso } from '../shared/sources/winnow/exif-from-row';
import { isoFromExifDateTime } from '../shared/roadtrip/media-date';
import { formatIsoDate } from '../shared/roadtrip/trip-days';
import { formatBytes, formatDuration } from '../shared/lib/format';

interface WinnowLightboxProps {
  connection: WinnowConnection;
  client: WinnowClient;
  /** The rows the tab is showing, in the order it shows them. */
  rows: readonly WinnowAssetRow[];
  /** Which one is open, an index into `rows`. */
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** `"<host>/<id>"` → the Library asset id it became. */
  inLibrary: ReadonlyMap<string, string>;
  picker: InstancePicker;
}

/**
 * One picture from the instance, large.
 *
 * The Library's tiles are 74px, which is enough to recognise a frame you
 * already know and not enough to choose between two of them. Where nothing on
 * screen is waiting for a picture — a trip's overview, a day picked by hand —
 * a click therefore opens this instead of downloading: the day is read here,
 * arrow by arrow, and only the picture that wins gets fetched (the button
 * below, which is the grid's own `pick`).
 *
 * Which of the two a click does is the publisher's call, not this component's:
 * `MediaScope.intent`. See `media-scope.tsx`.
 *
 * It shows the PROXY — the same rendition the pool would hold — so what is on
 * screen is what the editor would get, and no original is pulled to look at a
 * day. Winnow's own facts ride along the top; a photo proxy carries no EXIF of
 * its own, so this row is the only place they exist before the fetch.
 */
export default function WinnowLightbox({
  connection,
  client,
  rows,
  index,
  onIndex,
  onClose,
  inLibrary,
  picker,
}: WinnowLightboxProps) {
  const row = rows[index] ?? null;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [row?.id]);

  const step = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      // Wrapping: a day is a loop you sweep, not a list with two dead ends.
      onIndex((index + delta + rows.length) % rows.length);
    },
    [index, onIndex, rows.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    // The sidebar still scrolls behind a full-screen sheet otherwise.
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = bodyOverflow;
    };
  }, [onClose, step]);

  if (!row) return null;

  const have = inLibrary.get(`${connection.id}/${row.id}`);
  const busy = picker.fetching !== null;
  const isVideo = row.media_type === 'video';

  // The capture as the camera wrote it — the app's standing rule: the hour on
  // a picture is the hour it was where it was taken, never a conversion of it
  // (`exif-from-row.ts`). Nothing is invented when the row has no time.
  const stamp = exifTimestampFromIso(row.captured_at);
  const day = isoFromExifDateTime(stamp);
  const clock = stamp ? stamp.slice(11, 16) : null;
  const facts = [
    day ? `${formatIsoDate(day)}${clock ? ` · ${clock}` : ''}` : 'no capture time',
    row.width && row.height ? `${row.width}×${row.height}` : null,
    isVideo && row.duration_s ? formatDuration(row.duration_s) : null,
    row.camera_model,
    row.file_size ? formatBytes(row.file_size) : null,
    row.has_telemetry ? 'flight log' : null,
  ].filter(Boolean);

  const arrow = (label: string, delta: number, d: string) => (
    <button
      type="button"
      onClick={() => step(delta)}
      disabled={rows.length < 2}
      aria-label={label}
      title={`${label} (${delta < 0 ? '←' : '→'})`}
      className="flex-none self-center w-9 h-9 grid place-items-center rounded-full border border-line bg-surface text-ink-soft hover:text-accent hover:border-line-strong disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d={d}
        />
      </svg>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`${row.filename}, from ${connection.id}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[64rem] h-[min(90dvh,54rem)] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-4 overflow-hidden max-[820px]:max-w-none max-[820px]:h-dvh max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="m-0 font-serif text-[1.1rem] min-w-0 truncate" title={row.filename}>
            {row.filename}
          </h2>
          <span className="font-mono text-[0.62rem] text-muted whitespace-nowrap tabular-nums">
            {index + 1} / {rows.length}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2.5 py-[3px] hover:text-accent hover:border-line-strong transition-colors"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>

        <p className="m-0 font-mono text-[0.64rem] text-muted truncate" title={facts.join(' · ')}>
          {facts.join(' · ')}
        </p>

        {/* The frame. Fixed by the panel, so paging never resizes the sheet.
            `items-stretch` + `self-stretch`, never `h-full`: a percentage
            height inside a `flex-1 min-h-0` column has nothing definite to
            resolve against, so `max-h-full` measured nothing and the picture
            was cut by the `overflow-hidden` instead of fitting in it. The
            media then fills that box and is CONTAINED by `object-contain`,
            which is also what gives a clip its aspect ratio — a `<video>`
            with no fit takes its own default box and drew square. */}
        <div className="flex-1 min-h-0 flex items-stretch justify-center gap-3">
          {arrow('Previous', -1, 'M10 3.5 5.5 8 10 12.5')}
          <div className="relative flex-1 min-w-0 min-h-0 self-stretch bg-frame rounded-paper overflow-hidden">
            {isVideo ? (
              <video
                key={row.id}
                src={client.proxyUrl(row.id)}
                poster={client.thumbUrl(row.id)}
                crossOrigin="use-credentials"
                controls
                // Metadata only: opening a day should not stream every clip.
                preload="metadata"
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : (
              <>
                <img
                  key={row.id}
                  src={client.proxyUrl(row.id)}
                  alt={row.filename}
                  crossOrigin="use-credentials"
                  onLoad={() => setLoaded(true)}
                  className={`absolute inset-0 w-full h-full object-contain block transition-opacity ${
                    loaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                {!loaded && (
                  <span className="absolute inset-0 grid place-items-center font-mono text-[0.66rem] text-muted">
                    loading…
                  </span>
                )}
              </>
            )}
          </div>
          {arrow('Next', 1, 'M6 3.5 10.5 8 6 12.5')}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {have ? (
            <span className="font-mono text-[0.64rem] tracking-[0.08em] uppercase text-muted">
              ✓ in the library
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void picker.pick(row)}
              disabled={busy}
              className="font-mono text-[0.64rem] tracking-[0.1em] uppercase px-3 py-1.5 rounded-full bg-ink text-paper cursor-pointer disabled:opacity-50 disabled:cursor-wait"
            >
              {picker.fetching === row.id ? 'fetching…' : 'Add to library'}
            </button>
          )}
          <span className="text-[0.74rem] text-muted min-w-0 truncate">
            the proxy, from {connection.id} — nothing leaves your machine
          </span>
        </div>

        {picker.problem && (
          <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
            {picker.problem.text}{' '}
            {picker.problem.login && (
              <a
                className="font-semibold underline underline-offset-[3px]"
                href={picker.problem.login}
                target="_blank"
                rel="noreferrer"
              >
                Sign in there
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
