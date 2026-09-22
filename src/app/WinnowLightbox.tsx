import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { WinnowAssetRow, WinnowClient } from '../shared/sources/winnow/client';
import type { WinnowConnection } from '../shared/sources/winnow/store';
import type { InstancePicker } from '../shared/sources/winnow/use-pick';
import { exifTimestampFromIso } from '../shared/sources/winnow/exif-from-row';
import { isoFromExifDateTime } from '../shared/roadtrip/media-date';
import { formatIsoDate, WEEKDAYS, weekdayIndex } from '../shared/roadtrip/trip-days';
import type { DaySpan } from '../shared/sources/scope-override';
import { deckEntry, pageDirection, type Side } from '../shared/sources/winnow/day-walk';
import type { Neighbour, NeighbourDays } from '../shared/sources/winnow/use-neighbour-days';
import { formatBytes, formatDuration } from '../shared/lib/format';
import { exifFromRow } from '../shared/sources/winnow/exif-from-row';
import { exposureSummary } from '../shared/exif/exif-summary';
import MediaLightbox, { type LightboxItem } from '../shared/ui/MediaLightbox';
import MediaActionRow from '../shared/ui/MediaActionRow';
import { useMediaActions, type MediaAction } from '../shared/sources/media-scope';
import { rowCaptureInput } from '../shared/develop/capture-view';
import { useCaptureView } from '../shared/develop/use-capture-view';
import { renditionsOf, type Rendition } from '../shared/media/renditions';
import { heldOriginal, heldVersion, subscribeHeld } from '../shared/sources/original-cache';
import { captureMtime } from '../shared/sources/winnow/materialize';

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
  /** The day (or span) those rows are for. */
  span: DaySpan;
  /** True while the rows for `span` are still being asked for. */
  asking: boolean;
  /** Whether a file-name filter narrows `rows` — said when it empties them. */
  filtered: boolean;
  /** The nearest day with media on each side, as far as it is known. */
  neighbours: NeighbourDays;
  /**
   * Page onto a neighbouring day. The caller moves the tab there and hands
   * back that day's rows, opened on the first picture when going forward and
   * on the last when going back.
   */
  onRoll: (side: Side, day: string) => void;
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
 * **Past the last picture of the day, the next day.** The deck is
 * `[before, ...pictures, after]`: two cards that name the nearest day holding
 * media on either side (`day-walk.ts`), paged to like any picture. Landing on
 * one in the direction it points moves the Library's tab to that day — which,
 * from a tool's day, is the sidebar's own override, drawn as such on the
 * stepper behind this sheet — and the deck reopens on its first picture (or
 * its last, going back). Landing on one against its direction, across the
 * wrap, only shows it: a jump the arrow did not point at would be a surprise.
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
  span,
  asking,
  filtered,
  neighbours,
  onRoll,
}: WinnowLightboxProps) {
  // The day's own cards: its pictures, or the one card saying why there are
  // none to show — so the deck always has a middle for the edges to frame.
  const body = useMemo<LightboxItem[]>(() => {
    if (asking) return [placeholder(span, 'asking…')];
    if (rows.length === 0) {
      return [placeholder(span, filtered ? 'nothing on this day matches the filter' : 'nothing here')];
    }
    return rows.map((row) => itemFromRow(row, client));
    // The span's two strings, not the object the caller builds per render.
  }, [asking, rows, client, span.from, span.to, filtered]);
  const items = useMemo<LightboxItem[]>(
    () => [
      edgeCard('before', neighbours.before, connection.id),
      ...body,
      edgeCard('after', neighbours.after, connection.id),
    ],
    [body, neighbours, connection.id],
  );

  const healUrl = useCallback((url: string) => client.heal(url), [client]);

  // Sitting on an edge card, which side; and an edge landed on in its own
  // direction before its day was known, to be followed once it is.
  const [onEdge, setOnEdge] = useState<Side | null>(null);
  const [waiting, setWaiting] = useState<Side | null>(null);
  const bodyAt = Math.min(index, body.length - 1);
  const deckIndex = onEdge === 'before' ? 0 : onEdge === 'after' ? items.length - 1 : bodyAt + 1;

  const roll = (side: Side, day: string) => {
    setOnEdge(null);
    setWaiting(null);
    onRoll(side, day);
  };

  const onDeckIndex = (at: number) => {
    const dir = pageDirection(deckIndex, at, items.length);
    const entry = deckEntry(at, body.length);
    if (entry.kind === 'body') {
      setOnEdge(null);
      setWaiting(null);
      onIndex(entry.index);
      return;
    }
    const pointed = (entry.side === 'after') === (dir === 1);
    const next = neighbours[entry.side];
    if (pointed && next.state === 'day') {
      roll(entry.side, next.date);
      return;
    }
    setOnEdge(entry.side);
    setWaiting(pointed && next.state === 'asking' ? entry.side : null);
  };

  // The day behind a card that was landed on while still being looked for.
  useEffect(() => {
    if (!waiting) return;
    const next = neighbours[waiting];
    if (next.state === 'day') roll(waiting, next.date);
    else if (next.state !== 'asking') setWaiting(null);
    // Keyed on the answer alone: `roll` is a fresh closure every render, and
    // re-running on it would roll twice.
  }, [waiting, neighbours]);

  const row = onEdge || asking ? null : (rows[bodyAt] ?? null);
  const have = row ? inLibrary.get(`${connection.id}/${row.id}`) : undefined;
  const busy = picker.fetching !== null;

  // The capture's files behind the row on screen — the proxy it shows, the
  // primary's own file, the companion Winnow paired with it — as chips (R6 of
  // `docs/capture-renditions.md`). A chip fetches on its click and holds the
  // file for the session; the `held` subscription is what turns its arrow
  // off once it has. View state only: nothing here writes a document.
  const held = useSyncExternalStore(subscribeHeld, heldVersion);
  const viewRows = useMemo<Rendition[]>(
    () => (row && row.media_type === 'photo' ? renditionsOf(rowCaptureInput(row, connection.id, (id) => heldOriginal(id) !== null)) : []),
    // `held` is the cache's version: the rows must be rebuilt when a fetch lands.
    [row, connection.id, held],
  );
  const captureView = useCaptureView({
    key: row ? `${connection.id}/${row.id}` : null,
    rows: viewRows,
    openSrc: row ? client.proxyUrl(row.id) : null,
    fileFor: () => null,
    fetchFor: (r) => {
      if (!row || !r.assetId) return null;
      const id = Number(r.assetId.slice(r.assetId.lastIndexOf('/') + 1));
      if (!Number.isFinite(id)) return null;
      return (opts) => client.fetchFile(client.originalUrl(id), r.name, '', captureMtime(row), opts);
    },
  });

  // What the active tool can start from this picture. The fetch comes first
  // and the verb runs only if it landed: a piece made from a picture that
  // never arrived would open on a placeholder, which is the one thing the
  // thumbnail rule (`roadtrip.md`) says must not be composed over. The verb
  // is handed the file of the capture that was on screen.
  const offer = useMediaActions();
  const start = async (action: MediaAction) => {
    if (!row) return;
    const view = captureView.view;
    const assetId = await picker.pick(row);
    if (!assetId) return; // the sheet stays open on the problem the picker set
    action.run(view);
    onClose();
  };

  return (
    <MediaLightbox
      items={items}
      index={deckIndex}
      onIndex={onDeckIndex}
      onClose={onClose}
      from={`from ${connection.id}`}
      // These are the instance's own URLs, so a cache entry stored without the
      // CORS headers is a picture that will not draw until it is replaced
      // (`winnow/cache-heal.ts`).
      heal={healUrl}
      files={captureView.files}
      viewing={captureView.viewing}
      onViewing={captureView.setViewing}
      taskScope={row ? `${connection.id}/${row.id}` : null}
      // Enter does the one thing the sheet offers — and nothing at all once
      // the picture is already in the library.
      onConfirm={row && !have && !busy ? () => void picker.pick(row) : null}
      footer={
        row && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            {have ? (
              <span className="font-mono text-2xs tracking-[0.08em] uppercase text-muted">
                ✓ in the library
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void picker.pick(row)}
                disabled={busy}
                className="font-mono text-2xs tracking-[0.1em] uppercase px-3 py-1.5 rounded-full bg-ink text-paper cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              >
                {picker.fetching === row.id ? 'fetching…' : 'Add to library'}
              </button>
            )}
            {/* Secondary: this media back in the app it came from, in a tab of
                its own — the point being to look at what surrounds it there
                (its neighbours in the shoot, its verdicts, its exports), which
                is the one thing this sheet cannot show.

                It lands on the media's SESSION, not on the media: Winnow's
                viewer is an overlay held in local state and no route carries an
                asset, so the grid it lives in is the closest a link can get
                (`client.sessionUrl`). A row that somehow has no session falls
                back to what this button used to be, the proxy's own URL. */}
            <a
              href={row.session_id ? client.sessionUrl(row.session_id) : client.proxyUrl(row.id)}
              target="_blank"
              rel="noreferrer"
              title={
                row.session_id
                  ? `Open this ${row.media_type}'s session on ${connection.id}, in a new tab`
                  : `Open this ${row.media_type} on ${connection.id}, in a new tab`
              }
              className="font-mono text-2xs tracking-[0.1em] uppercase px-3 py-1.5 rounded-full border border-line-strong text-ink no-underline hover:border-accent hover:text-accent-ink transition-colors"
            >
              Open in Winnow ↗
            </a>
            <span className="text-xs text-muted min-w-0 truncate">
              the proxy, from {connection.id} — nothing leaves your machine
            </span>
          </div>

          {/* Starting a piece from here brings the picture across on the way,
              so the two-step (add, then go and make something of it) is one
              gesture. */}
          <MediaActionRow offer={offer} onRun={(a) => void start(a)} busy={busy} />

          {picker.problem && (
            <p className="m-0 text-xs text-danger" role="alert">
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
        )
      }
    />
  );
}

const dayName = (iso: string) => `${WEEKDAYS[weekdayIndex(iso) ?? 0]} ${formatIsoDate(iso)}`;

/** The one card of a day with no picture to show, or not yet. */
function placeholder(span: DaySpan, why: string): LightboxItem {
  const title = span.from === span.to ? dayName(span.from) : `${formatIsoDate(span.from)} → ${formatIsoDate(span.to)}`;
  return {
    id: `day:${span.from}:${span.to}`,
    title,
    facts: why,
    kind: 'photo',
    src: null,
    still: null,
    natural: null,
    unavailable: why,
    uncounted: true,
  };
}

/**
 * A card at one end of the day: the nearest day with media that way, or why
 * there is none to go to. Keyed by its side alone, so the deck keeps the node
 * while its words change from "looking…" to the day.
 */
function edgeCard(side: Side, next: Neighbour, host: string): LightboxItem {
  const arrow = side === 'after' ? '→' : '←';
  const way = side === 'after' ? 'next' : 'previous';
  const said = ((): { title: string; facts: string; line: string } => {
    switch (next.state) {
      case 'day':
        return {
          title: dayName(next.date),
          facts: `the ${way} day with media`,
          line: `${arrow} ${dayName(next.date)} · ${next.count} file${next.count === 1 ? '' : 's'}`,
        };
      case 'asking':
        return { title: `The ${way} day`, facts: 'asking…', line: `looking for the ${way} day with media…` };
      case 'none':
        return {
          title: `No ${way} day`,
          facts: 'the edge of what it holds',
          line: `${host} holds nothing ${side === 'after' ? 'after' : 'before'} this day`,
        };
      case 'failed':
        return { title: `The ${way} day`, facts: 'no answer', line: `could not ask ${host}` };
    }
  })();
  return {
    id: `edge:${side}`,
    title: said.title,
    facts: said.facts,
    kind: 'photo',
    src: null,
    still: null,
    natural: null,
    unavailable: said.line,
    uncounted: true,
  };
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
