import { useEffect, useMemo, useState } from 'react';
import {
  WinnowClient,
  WinnowError,
  hasTimeline,
  type WinnowChapter,
} from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import {
  applyTimelineDiff,
  diffTimeline,
  importTimeline,
  tripFromTimeline,
  type DiffEntry,
  type TimelineImport,
} from '../../shared/roadtrip/timeline-import';
import { formatIsoDate, spanLength } from '../../shared/roadtrip/trip-days';
import { PLACE_ARROW, stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc, TripStage } from '../../shared/roadtrip/trip-types';

/**
 * What the panel is for: creating a trip from the timeline, narrowed to the
 * legs a link named (empty = all), or reconciling the timeline into a trip
 * that already exists.
 */
export type TimelineImportMode =
  | { kind: 'seed'; preselect: string[] }
  | { kind: 'complete'; trip: TripDoc };

interface TimelineImportPanelProps {
  connection: WinnowConnection;
  mode: TimelineImportMode;
  onCancel: () => void;
  /** Seed: the new trip, not yet stored. */
  onSeed: (trip: TripDoc) => void;
  /** Complete: the trip with the accepted entries applied. */
  onApply: (trip: TripDoc, spanWidened: boolean) => void;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const input =
  'font-sans text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-[1rem]';
const row =
  'flex items-start gap-3 py-2 border-b border-line last:border-b-0 text-[0.84rem] leading-snug';
const check = 'mt-[3px] w-[15px] h-[15px] accent-ink flex-none max-[820px]:w-[18px] max-[820px]:h-[18px]';
const problemInk = 'text-[#9a3a23]';

function explain(err: unknown, client: WinnowClient): { text: string; login?: string } {
  if (err instanceof WinnowError && err.kind === 'unauthenticated') {
    return { text: `Not signed in to ${client.config.baseUrl}.`, login: client.loginUrl() };
  }
  return { text: err instanceof Error ? err.message : String(err) };
}

/** `5 Nov 2025 → 8 Nov 2025 · 4 days`, or one day. */
function spanText(start: string, end: string): string {
  const days = spanLength(start, end);
  const dates = start === end ? formatIsoDate(start) : `${formatIsoDate(start)} → ${formatIsoDate(end)}`;
  return days === null ? dates : `${dates} · ${days} day${days === 1 ? '' : 's'}`;
}

function routeOf(stage: TripStage): string {
  return (stage.places ?? [])
    .map((p) => p.name.trim())
    .filter(Boolean)
    .join(` ${PLACE_ARROW} `);
}

/** What a chapter is called before it is a stage — the same rule as the import's. */
function chapterName(chapter: WinnowChapter): string {
  const title = chapter.title?.trim();
  if (title) return title;
  const names = chapter.places.map((p) => p.name.trim()).filter(Boolean);
  if (!names.length) return `chapter ${chapter.id}`;
  return names[0] === names[names.length - 1]
    ? names[0]
    : `${names[0]} ${PLACE_ARROW} ${names[names.length - 1]}`;
}

/** What accepting one diff entry would do, in a sentence. */
function describe(entry: DiffEntry): string {
  const incoming = entry.incoming;
  const existing = entry.existing;
  switch (entry.kind) {
    case 'add':
      return `Add “${stageLabel(incoming!) || 'an unnamed leg'}” · ${spanText(incoming!.startDate, incoming!.endDate)}`;
    case 'dropped':
      return `Drop “${stageLabel(existing!) || 'an unnamed leg'}” · ${spanText(existing!.startDate, existing!.endDate)} — it is no longer in the timeline`;
    case 'unchanged':
      return existing!.origin
        ? `“${stageLabel(existing!)}” · unchanged`
        : `“${stageLabel(existing!) || 'an unnamed leg'}” matches a leg of the timeline — link it, so the next import finds it`;
    case 'changed': {
      const parts: string[] = [];
      if (entry.changes.includes('name')) {
        parts.push(`now called “${stageLabel(incoming!) || 'nothing'}”`);
      }
      if (entry.changes.includes('span')) {
        parts.push(`now ${spanText(incoming!.startDate, incoming!.endDate)}`);
      }
      if (entry.changes.includes('places')) {
        parts.push(`route now ${routeOf(incoming!) || 'no place'}`);
      }
      return `“${stageLabel(existing!) || 'an unnamed leg'}” · ${parts.join(' · ')}`;
    }
  }
}

/** The default tick: take what the timeline gained or moved, never drop on its own. */
function defaultAccepted(entries: DiffEntry[]): Set<string> {
  return new Set(
    entries
      .filter(
        (e) =>
          e.kind === 'add' ||
          e.kind === 'changed' ||
          (e.kind === 'unchanged' && !e.existing?.origin),
      )
      .map((e) => e.key),
  );
}

/**
 * Seed a trip from a Winnow timeline, or complete one — the two screens over
 * ONE piece of arithmetic (`timeline-import.ts`). Both show exactly what they
 * will do and do nothing until the person says so: a seed lists the legs, the
 * span, the days no leg covers and every chapter it could not use; a
 * completion lists what the timeline gained, renamed, moved or lost, each
 * line a tick the author gives or withholds. Nothing the author wrote is ever
 * overwritten silently, and no post is ever created.
 *
 * It costs no bytes beyond one JSON fetch: a timeline is metadata.
 */
export default function TimelineImportPanel({
  connection,
  mode,
  onCancel,
  onSeed,
  onApply,
}: TimelineImportPanelProps) {
  const client = useMemo(
    () => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }),
    [connection.baseUrl, connection.auth],
  );
  const offered = hasTimeline(connection.capabilities);

  const [chapters, setChapters] = useState<WinnowChapter[] | null>(null);
  const [problem, setProblem] = useState<{ text: string; login?: string } | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // One request, on open: the chapters. Nothing else crosses the wire here.
  useEffect(() => {
    if (!offered) return;
    let cancelled = false;
    setChapters(null);
    setProblem(null);
    client
      .timeline()
      .then((list) => {
        if (!cancelled) setChapters(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      });
    return () => {
      cancelled = true;
    };
  }, [client, offered]);

  // Seed: which legs go in. A link's preselection wins when it names legs
  // that exist; otherwise every leg starts ticked — the span is the point.
  const picked = useMemo<ReadonlySet<string>>(() => {
    if (selected) return selected;
    if (!chapters) return new Set();
    if (mode.kind === 'seed' && mode.preselect.length) {
      const named = new Set(mode.preselect);
      const present = chapters.filter((c) => named.has(c.id)).map((c) => c.id);
      if (present.length) return new Set(present);
    }
    return new Set(chapters.map((c) => c.id));
  }, [selected, chapters, mode]);

  const sourceId = connection.id;
  const imported = useMemo<TimelineImport | null>(() => {
    if (!chapters) return null;
    const input = mode.kind === 'seed' ? chapters.filter((c) => picked.has(c.id)) : chapters;
    return importTimeline(input, { sourceId, importedAt: Date.now() });
  }, [chapters, picked, mode.kind, sourceId]);

  const entries = useMemo<DiffEntry[]>(
    () =>
      mode.kind === 'complete' && imported ? diffTimeline(mode.trip, imported, sourceId) : [],
    [mode, imported, sourceId],
  );
  const ticked = accepted ?? defaultAccepted(entries);
  const actionable = entries.filter((e) => !(e.kind === 'unchanged' && e.existing?.origin));

  function toggle(set: ReadonlySet<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function seed() {
    if (!imported) return;
    const trip = tripFromTimeline(name, imported);
    if (trip) onSeed(trip);
  }

  function apply() {
    if (mode.kind !== 'complete') return;
    const result = applyTimelineDiff(mode.trip, entries, ticked);
    onApply(result.trip, result.spanWidened);
  }

  const title = mode.kind === 'seed' ? `New trip from ${connection.id}` : `Complete from ${connection.id}`;
  const warnings = imported?.warnings ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[40rem] max-h-[90dvh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 max-[820px]:max-w-none max-[820px]:max-h-none max-[820px]:h-dvh max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:px-4 max-[820px]:pt-4">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">{title}</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">
            {mode.kind === 'seed'
              ? 'The timeline’s legs become the trip’s stages — its span, its places. No post is created: the grid stays yours to fill.'
              : 'What the timeline has that the trip does not, and the reverse. Nothing you wrote changes unless you tick it.'}
          </p>
        </div>

        {!offered ? (
          <p className="m-0 text-[0.84rem] text-muted">
            {connection.id} has no timeline yet. Reconnect it once it does, and this
            screen will list its legs.
          </p>
        ) : problem ? (
          <p className={`m-0 text-[0.84rem] ${problemInk}`} role="alert">
            {problem.text}{' '}
            {problem.login && (
              <a className="font-semibold underline underline-offset-[3px]" href={problem.login} target="_blank" rel="noreferrer">
                Sign in there
              </a>
            )}
          </p>
        ) : chapters === null ? (
          <p className="m-0 font-mono text-[0.72rem] text-muted">asking {connection.id}…</p>
        ) : chapters.length === 0 ? (
          <p className="m-0 text-[0.84rem] text-muted">The timeline has no chapter yet.</p>
        ) : mode.kind === 'seed' ? (
          <>
            {/* --- the legs, each a tick ---------------------------------- */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3">
                <span className={legend}>legs · {picked.size} of {chapters.length}</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelected(picked.size === chapters.length ? new Set() : new Set(chapters.map((c) => c.id)))
                  }
                  className="p-0 border-0 bg-transparent font-mono text-[0.58rem] tracking-[0.1em] uppercase text-muted cursor-pointer hover:text-accent"
                >
                  {picked.size === chapters.length ? 'none' : 'all'}
                </button>
              </div>
              <ul className="m-0 p-0 list-none flex flex-col max-h-[14rem] overflow-auto pr-1 border border-line rounded-paper px-3">
                {chapters.map((c) => (
                  <li key={c.id} className={row}>
                    <input
                      type="checkbox"
                      className={check}
                      checked={picked.has(c.id)}
                      onChange={() => setSelected(toggle(picked, c.id))}
                      aria-label={`Include ${chapterName(c)}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">{chapterName(c)}</span>
                      <span className="block font-mono text-[0.62rem] text-muted tabular-nums">
                        {c.startDate && c.endDate ? spanText(c.startDate, c.endDate) : 'undated'}
                        {' · '}{c.assetCount} media
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* --- what will be created — the real numbers, or why none --- */}
            {imported && (
              <div className="flex flex-col gap-1.5 text-[0.82rem]">
                {imported.span ? (
                  <>
                    <p className="m-0">
                      <span className="font-semibold">{imported.stages.length} stage{imported.stages.length === 1 ? '' : 's'}</span>
                      {' · '}{spanText(imported.span.startDate, imported.span.endDate)}
                      {imported.destination && <> · {imported.destination}</>}
                    </p>
                    <ul className="m-0 pl-4 text-[0.78rem] text-muted">
                      {imported.stages.map((s) => (
                        <li key={s.id}>
                          {stageLabel(s) || <em>no place — the badge will count the day of the trip</em>}
                          {' · '}{spanText(s.startDate, s.endDate)}
                        </li>
                      ))}
                    </ul>
                    {imported.uncovered.length > 0 && (
                      <p className="m-0 text-[0.78rem] text-muted">
                        {imported.uncovered.reduce((n, g) => n + g.length, 0)} day
                        {imported.uncovered.reduce((n, g) => n + g.length, 0) === 1 ? '' : 's'} belong to no leg:{' '}
                        {imported.uncovered.map((g) => spanText(g.start, g.end).replace(/ · .*$/, '')).join(', ')}.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="m-0 text-muted">No dated leg is ticked — there is no span to make a trip from.</p>
                )}
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className={legend}>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') seed();
                }}
                placeholder="Australie"
                className={input}
              />
              <span className="text-[0.7rem] text-faint">Short — it is what a badge says over the picture.</span>
            </label>
          </>
        ) : (
          <>
            {/* --- the diff, one tick per line ----------------------------- */}
            {actionable.length === 0 ? (
              <p className="m-0 text-[0.84rem] text-muted">
                Your trip already matches the timeline — {entries.length} leg{entries.length === 1 ? '' : 's'}, nothing to change.
              </p>
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col border border-line rounded-paper px-3">
                {entries.map((e) => {
                  const inert = e.kind === 'unchanged' && !!e.existing?.origin;
                  return (
                    <li key={e.key} className={`${row} ${inert ? 'text-muted' : ''}`}>
                      <input
                        type="checkbox"
                        className={check}
                        checked={!inert && ticked.has(e.key)}
                        disabled={inert}
                        onChange={() => setAccepted(toggle(ticked, e.key))}
                        aria-label={describe(e)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`font-mono text-[0.58rem] tracking-[0.1em] uppercase mr-2 ${e.kind === 'dropped' ? problemInk : 'text-muted'}`}>
                          {e.kind === 'unchanged' && !inert ? 'link' : e.kind}
                          {e.matchedBy && e.matchedBy !== 'id' && ` · matched by ${e.matchedBy}`}
                        </span>
                        {describe(e)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {warnings.length > 0 && (
          <ul className="m-0 pl-4 text-[0.76rem] text-muted">
            {warnings.map((w, i) => (
              <li key={`${w.kind}-${w.chapterId}-${i}`}>{w.message}</li>
            ))}
          </ul>
        )}

        <div className="sticky bottom-0 -mx-6 mt-auto px-6 pb-6 flex items-center justify-end gap-4 pt-1 border-t border-line bg-surface max-[820px]:-mx-4 max-[820px]:px-4 max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          {mode.kind === 'seed' ? (
            <button
              type="button"
              onClick={seed}
              disabled={!imported?.span || !name.trim()}
              className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create trip
            </button>
          ) : (
            <button
              type="button"
              onClick={apply}
              disabled={!entries.length || [...ticked].filter((k) => actionable.some((e) => e.key === k)).length === 0}
              className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply {[...ticked].filter((k) => actionable.some((e) => e.key === k)).length || ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
