import { useMemo } from 'react';
import type { WinnowAssetRow, WinnowClient } from '../shared/sources/winnow/client';
import type { WinnowConnection } from '../shared/sources/winnow/store';
import type { InstancePicker } from '../shared/sources/winnow/use-pick';
import { exifTimestampFromIso } from '../shared/sources/winnow/exif-from-row';
import { isoFromExifDateTime } from '../shared/roadtrip/media-date';
import { formatIsoDate } from '../shared/roadtrip/trip-days';
import { formatBytes, formatDuration } from '../shared/lib/format';
import { exifFromRow } from '../shared/sources/winnow/exif-from-row';
import { exposureSummary } from '../shared/exif/exif-summary';
import MediaLightbox, { type LightboxItem } from '../shared/ui/MediaLightbox';

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
 * The instance's rows, in the shared lightbox — plus the one thing that is
 * particular to them: bringing a picture across.
 *
 * The Library's tiles are 74px, which is enough to recognise a frame you
 * already know and not enough to choose between two of them. Where nothing on
 * screen is waiting for a picture — a trip's overview, a day picked by hand —
 * a click therefore opens this instead of downloading: the day is read here,
 * gesture by gesture, and only the picture that wins gets fetched (the footer
 * button, which is the grid's own `pick`).
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
  const items = useMemo<LightboxItem[]>(
    () => rows.map((row) => itemFromRow(row, client)),
    [rows, client],
  );

  const row = rows[index] ?? null;
  const have = row ? inLibrary.get(`${connection.id}/${row.id}`) : undefined;
  const busy = picker.fetching !== null;
  if (!row) return null;

  return (
    <MediaLightbox
      items={items}
      index={index}
      onIndex={onIndex}
      onClose={onClose}
      from={`from ${connection.id}`}
      // Enter does the one thing the sheet offers — and nothing at all once
      // the picture is already in the library.
      onConfirm={!have && !busy ? () => void picker.pick(row) : null}
      footer={
        <>
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
            {/* Secondary: the media itself, on the instance, in a tab of its
                own. Winnow has no page per asset, so this is the proxy's own
                URL — the rendition the sheet is already showing, at full size
                and outside the app. */}
            <a
              href={client.proxyUrl(row.id)}
              target="_blank"
              rel="noreferrer"
              title={`Open this ${row.media_type} on ${connection.id}, in a new tab`}
              className="font-mono text-[0.64rem] tracking-[0.1em] uppercase px-3 py-1.5 rounded-full border border-line-strong text-ink no-underline hover:border-accent hover:text-accent-ink transition-colors"
            >
              Open ↗
            </a>
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
        </>
      }
    />
  );
}

function itemFromRow(row: WinnowAssetRow, client: WinnowClient): LightboxItem {
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
    row.file_size ? formatBytes(row.file_size) : null,
    row.has_telemetry ? 'flight log' : null,
  ].filter(Boolean);

  // The body and the glass move to their own line. `exifFromRow` is the one
  // reading of those columns in the app — it deliberately leaves out the two
  // display labels (the camera's name, the lens), which are not part of a cue
  // and are added here, where they are read rather than drawn.
  const camera = exposureSummary(
    { ...(exifFromRow(row) ?? {}), lensModel: row.lens ?? undefined },
    row.camera_model,
  );

  return {
    id: String(row.id),
    title: row.filename,
    facts: facts.join(' · '),
    camera,
    kind: isVideo ? 'video' : 'photo',
    src: client.proxyUrl(row.id),
    // The thumbnail, drawn under the proxy while it arrives — and all a
    // neighbour slot ever draws for a clip.
    still: client.thumbUrl(row.id),
    natural: row.width && row.height ? { width: row.width, height: row.height } : null,
    credentialed: true,
  };
}
