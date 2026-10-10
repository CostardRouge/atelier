import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_DRAFT,
  answer as answerDraft,
  applyDraft,
  deducedStages,
  draftOutcome,
  draftSize,
  edit as editDraft,
  keepSkips,
  removeDeduced,
  rename as renameDraft,
  resetEdit as resetEditDraft,
  choosePlace,
  type DeduceDraft,
  type DraftOutcome,
} from '../../../shared/roadtrip/deduce-draft';
import { addPolarstepsFiles, sourcesOf, type PolarstepsExport } from '../../../shared/roadtrip/polarsteps';
import { fixesFrom, makeTripRoad, roadSourceText, tripRoadLine, DEFAULT_ROAD_MODE, type RoadSource } from '../../../shared/roadtrip/road-track';
import type { TripDoc } from '../../../shared/roadtrip/trip-types';
import { filesFromDataTransfer } from '../../../shared/sources/file-sources';
import type { WinnowConnection } from '../../../shared/sources/winnow/store';
import Button from '../../../shared/ui/Button';
import OverflowMenu from '../../../shared/ui/OverflowMenu';
import InfoDot from '../../../shared/ui/InfoDot';
import Segmented from '../../../shared/ui/Segmented';
import useDialogKeys from '../../../shared/ui/use-dialog-keys';
import CalqueWindow, { visibleUnder } from './CalqueWindow';
import DeckWindow from './DeckWindow';
import GrainWindow from './GrainWindow';
import { DataPane, DonePane, ReviewPane } from './panes';
import { plural } from './pieces';
import PolarstepsChip, { exportTexts } from './PolarstepsChip';
import { DEFAULT_SETTINGS, readSettings, readTab, writeSettings, writeTab, type DeduceSettings, type DeduceTab } from './settings';
import { useDeduction } from './use-deduction';
import type { DeduceActions, DeduceContext, DeduceIntent } from './context';
import { revealInScroller } from '../../../shared/ui/reveal';

/**
 * Deduce the itinerary — three windows over one draft.
 *
 * The first version of this modal asked six settings and answered with a
 * list of sentences; adding stages from it *«polluait l'interface»*. The
 * maintainer wanted all three windows of the lab that followed, each with
 * its own usage, and asked how one passes from one to the other (labs of
 * 2026-10-01/02, `roadtrip.md`). So:
 *
 * - **A · Le grain** — one slider, the stages as cards, the map beside them.
 * - **B · Le calque** — an intent first, the proposals under the author's
 *   own stages, a tick per line.
 * - **C · Le paquet** — one chapter at a time, answered in one gesture.
 *
 * They are TABS of the modal, and three views of ONE draft (`deduce-draft.ts`):
 * a verb set in any of them is the verb the others show, an edit made in
 * one is what the others draw. A switch keeps everything; a hand-off
 * carries the chapter under the hand — a card's *Deck ›* opens the paquet
 * on it, a chapter's *In the list ›* finds its card in the grain.
 *
 * Nothing is written before REVIEW, and Write is the only writing verb. What
 * it writes carries a mark, which is one undo step and one menu verb to
 * take out again. The library's flaws are said in a strip under the title,
 * detailed in the Data pane — never silently swallowed.
 *
 * **One request, and one only.** `geoDays` answers the whole question,
 * declared gaps included; a slider recomputes from the days already read.
 *
 * **A Polarsteps export may be dropped in** (2026-10-08, `polarsteps.ts`):
 * its track places a day before the instance does, on the day's own clock,
 * and its steps name the places before the index. One chip says it; the
 * files are read here and forgotten with the window. GPX files stand in for
 * its `locations.json` (`gpx.ts`), alone or beside a `trip.json`.
 */

interface DeduceStagesPanelProps {
  connection: WinnowConnection;
  trip: TripDoc;
  onCancel: () => void;
  /** Write the trip — the modal stays open, on the Written pane. */
  onWrite: (trip: TripDoc, spanWidened: boolean) => void;
  /** The tool's own undo, offered on the Written pane. */
  onUndo?: () => void;
  canUndo?: boolean;
}

type Pane = 'window' | 'data' | 'review' | 'done';

const TABS: { id: DeduceTab; key: string; label: string; sub: string }[] = [
  { id: 'grain', key: 'A', label: 'All stages', sub: 'One grain for the whole trip; each stage then has its own verb.' },
  { id: 'calque', key: 'B', label: 'Against mine', sub: 'What your pictures say, laid under the stages you already have.' },
  { id: 'paquet', key: 'C', label: 'One by one', sub: 'One chapter at a time, answered in one gesture.' },
];

/** The keys, said once behind the ⓘ beside the tabs — never a standing line. */
const KEYS: [string, string][] = [
  ['A B C', 'switch the window, carrying the stage under the hand'],
  ['↑ ↓', 'move between the stages of All stages'],
  ['Space', 'keep or skip the focused stage'],
  ['E', 'edit it'],
  ['1 – 4 · →', 'answer in One by one; ← goes back'],
  ['Enter', 'Review, then Write'],
];

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('input, select, textarea, [contenteditable="true"]');

export default function DeduceStagesPanel({ connection, trip, onCancel, onWrite, onUndo, canUndo = false }: DeduceStagesPanelProps) {
  const [tab, setTab] = useState<DeduceTab>(readTab);
  const [pane, setPane] = useState<Pane>('window');
  const [settings, setSettingsState] = useState<DeduceSettings>(readSettings);
  const [draft, setDraft] = useState<DeduceDraft>(EMPTY_DRAFT);
  const [hot, setHot] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [intent, setIntent] = useState<DeduceIntent>('enrich');
  const [index, setIndex] = useState(0);
  const [landing, setLanding] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<DraftOutcome | null>(null);
  const [polarsteps, setPolarsteps] = useState<PolarstepsExport | null>(null);
  const [polarError, setPolarError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Keep the export's track as the trip's ROAD (`road-track.ts`): on by
  // default whenever the export carries one — it is what the openers drive.
  const [keepRoad, setKeepRoad] = useState(true);
  // What the next read adds to — a drop may land while the last one is read.
  const polarRef = useRef<PolarstepsExport | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const deduction = useDeduction(connection, trip, settings, draft, polarsteps);
  const { proposals, sourceId } = deduction;

  const outcome = useMemo(() => draftOutcome(proposals, draft, { sourceId, now: 0 }), [proposals, draft, sourceId]);
  const toWrite = outcome.adds.length + outcome.completes.length;
  // Where the track came from — a GPX stands in for locations.json.
  const roadSource: RoadSource = polarsteps?.track?.origin === 'gpx' ? 'gpx' : 'polarsteps';
  // The road the export would give the trip, measured as the trip reads it.
  const roadOffer = useMemo(() => {
    const fixes = polarsteps?.track?.fixes ?? [];
    if (fixes.length < 2) return null;
    const road = makeTripRoad(fixesFrom(fixes), trip, trip.road, 0, roadSource);
    if (!road) return null;
    // Measured within the trip's span, as the trip reads it (as the crow
    // flies reads nothing, so the default reading is said instead).
    const mode = road.mode === 'crow' ? DEFAULT_ROAD_MODE : road.mode;
    const line = tripRoadLine({ ...road, mode, steer: null });
    return { fixes: road.fixes, km: line.km, read: mode === 'stages' ? 'between stays' : mode === 'moves' ? 'every move' : 'raw' };
  }, [polarsteps, trip, roadSource]);
  const writesRoad = keepRoad && roadOffer !== null;
  const canWrite = toWrite > 0 || writesRoad;

  const setSettings = useCallback((patch: Partial<DeduceSettings>) => {
    setSettingsState((cur) => {
      const next = { ...cur, ...patch };
      writeSettings(next);
      return next;
    });
    setEditing(null);
  }, []);

  const goTo = useCallback(
    (next: DeduceTab, key?: string | null) => {
      setTab(next);
      writeTab(next);
      setPane('window');
      setEditing(null);
      if (key) {
        setLanding(key);
        if (next === 'paquet') {
          const at = proposals.findIndex((p) => p.key === key);
          if (at >= 0) setIndex(at);
        }
        if (next === 'calque') {
          const p = proposals.find((x) => x.key === key);
          if (p && !visibleUnder(intent, [p]).length) setIntent('all');
        }
      }
    },
    [proposals, intent],
  );

  const actions = useMemo<DeduceActions>(
    () => ({
      answer: (key, verb) => setDraft((d) => answerDraft(d, key, verb)),
      edit: (p, patch) => setDraft((d) => editDraft(d, p, patch)),
      resetEdit: (key) => setDraft((d) => resetEditDraft(d, key)),
      rename: (halt, name) => setDraft((d) => renameDraft(d, halt, name)),
      choose: (halt, pick) => setDraft((d) => choosePlace(d, halt, pick)),
      setDraft,
      setSettings,
      resetSettings: () => setSettings({ ...DEFAULT_SETTINGS, grain: settings.grain }),
      goTo,
      setHot,
      setEditing,
      setIntent,
      setIndex,
    }),
    [setSettings, goTo, settings.grain],
  );

  // A new window opens at its top; a hand-off lands on its chapter, which
  // is outlined for a moment, focused in the grain, scrolled into view.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (!landing) {
      body.scrollTop = 0;
      return;
    }
    const el = body.querySelector<HTMLElement>(`[data-key="${CSS.escape(landing)}"]`);
    setLanding(null);
    if (!el) return;
    revealInScroller(el, { block: 'center' });
    if (tab === 'grain') el.focus({ preventScroll: true });
    setHot(landing);
    setFlash(landing);
    // `landing` is the one trigger; the pane and the tab are what it lands in.
  }, [landing, tab, pane]);

  // The outline fades on its own clock, whatever else re-renders meanwhile.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(t);
  }, [flash]);

  // A pick or a drop: the files read, each kind replacing what was there.
  const readPolarsteps = useCallback(
    async (files: File[]) => {
      const texts = await exportTexts(files);
      if (!texts.length) {
        setPolarError('Nothing to read here: drop trip.json, locations.json, their folder or GPX files.');
        return;
      }
      const { value, errors } = addPolarstepsFiles(polarRef.current, texts, { from: trip.startDate, to: trip.endDate });
      polarRef.current = value;
      setPolarsteps(value);
      setPolarError(errors.length ? errors.join(' ') : null);
    },
    [trip.startDate, trip.endDate],
  );

  function write() {
    const now = Date.now();
    const out = draftOutcome(proposals, draft, { sourceId, now });
    const applied = applyDraft(trip, out, now);
    const fixes = polarsteps?.track?.fixes ?? [];
    const written = writesRoad
      ? { ...applied.trip, road: makeTripRoad(fixesFrom(fixes), applied.trip, trip.road, now, roadSource) }
      : applied.trip;
    onWrite(written, applied.spanWidened);
    setLastRun(out);
    setDraft(keepSkips(draft));
    setEditing(null);
    setIndex(0);
    setPane('done');
  }

  // The window's own keys: A B C switch it, carrying the chapter under the
  // hand; the grain walks its cards, the paquet answers with digits. Bound
  // BEFORE the dialog's own listener so an Escape that closes an editor is
  // not also the Escape that closes the modal.
  const keysRef = useRef({ tab, pane, editing, hot, index, proposals, goTo });
  keysRef.current = { tab, pane, editing, hot, index, proposals, goTo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = keysRef.current;
      if (e.key === 'Escape' && s.editing) {
        e.preventDefault();
        setEditing(null);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (s.pane !== 'window') return;
      const body = bodyRef.current;
      if (!body) return;
      const under = s.hot ?? (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key ?? null;
      const key = e.key.toLowerCase();
      if (key === 'a' || key === 'b' || key === 'c') {
        const next: DeduceTab = key === 'a' ? 'grain' : key === 'b' ? 'calque' : 'paquet';
        const carried = s.tab === 'paquet' ? (s.proposals[s.index]?.key ?? null) : under;
        if (next !== s.tab) s.goTo(next, carried);
        return;
      }
      if (s.tab === 'grain') {
        const cards = [...body.querySelectorAll<HTMLElement>('[data-cards] [data-key]')];
        const at = cards.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = cards[Math.max(0, Math.min(cards.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
          next?.focus({ preventScroll: true });
          revealInScroller(next);
          return;
        }
        if (at >= 0 && (e.key === ' ' || key === 'e')) {
          e.preventDefault();
          const k = cards[at].dataset.key!;
          const p = s.proposals.find((x) => x.key === k);
          if (!p) return;
          if (e.key === ' ') {
            setDraft((d) => answerDraft(d, k, p.verb === 'skip' ? (p.safe !== 'skip' ? p.safe : 'stage') : 'skip'));
          } else setEditing((cur) => (cur === k ? null : k));
        }
        return;
      }
      if (s.tab === 'paquet') {
        const current = s.proposals[s.index];
        if (e.key === 'ArrowLeft') {
          setIndex((i) => Math.max(0, i - 1));
          setEditing(null);
          return;
        }
        if (!current) return;
        if (key === 'e') {
          setEditing((cur) => (cur === current.key ? null : current.key));
          return;
        }
        const verbs: Record<string, string> = { '1': 'stage', '2': 'split', '3': 'trim', '4': 'into', ArrowRight: 'skip' };
        const verb = verbs[e.key];
        if (!verb) return;
        const button = body.querySelector<HTMLButtonElement>(`[data-answer="${verb}"]`);
        if (button && !button.disabled) {
          e.preventDefault();
          button.click();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useDialogKeys({
    onCancel: () => {
      if (pane === 'window' || pane === 'done') onCancel();
      else setPane('window');
    },
    onConfirm:
      pane === 'window' && canWrite ? () => setPane('review') : pane === 'review' && canWrite ? write : pane === 'done' ? onCancel : null,
  });

  const ctx: DeduceContext = { trip, deduction, draft, settings, hot, flash, editing, intent, index, actions };
  const size = draftSize(draft);
  const draftParts = [size.answers ? plural(size.answers, 'verb') : '', size.edits ? plural(size.edits, 'edit') : '', size.names ? plural(size.names, 'name') : ''].filter(Boolean);
  const written = deducedStages(trip).length;
  const flaws = [
    deduction.outliers.length ? `${plural(deduction.outliers.length, 'outlier')} ${settings.ignoreOutliers ? 'ignored' : 'kept'}` : '',
    (() => {
      const n = deduction.chapters.flatMap((c) => c.halts).filter((h) => !h.city && !h.step).length;
      return n ? plural(n, 'unnamed halt') : '';
    })(),
  ].filter(Boolean);
  const placed = deduction.track?.points.length ?? 0;
  const bySource = deduction.track && polarsteps ? sourcesOf(deduction.track) : null;
  const blind = deduction.track?.blind.length ?? 0;
  const ago = deduction.readAt ? Math.max(0, Math.round((Date.now() - deduction.readAt) / 60_000)) : null;

  const title =
    pane === 'review' ? 'Before writing' : pane === 'done' ? 'Written' : pane === 'data' ? 'What was read' : 'Deduce the itinerary';
  const subtitle =
    pane === 'review'
      ? 'Exactly what Write will do. Nothing else is touched.'
      : pane === 'done'
        ? 'The trip now carries these. Undo takes all of it back in one step.'
        : pane === 'data'
          ? `${sourceId} · one position per day, no picture fetched.`
          : null;

  const summary = toWrite
    ? [outcome.adds.length ? `${outcome.adds.length} new` : '', outcome.completes.length ? `${outcome.completes.length} completed` : ''].filter(Boolean).join(' · ')
    : deduction.problem
      ? ''
      : 'Nothing to write with these answers.';

  const padX = 'px-6 max-[820px]:px-4';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Deduce the itinerary"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(false);
          // Read the drop's items now: they are emptied once the event returns.
          void filesFromDataTransfer(e.dataTransfer).then(readPolarsteps);
        }}
        className={`${dragging ? 'outline outline-2 outline-dashed outline-accent -outline-offset-4 ' : ''}w-[calc(100vw-4rem)] max-w-[100rem] max-[820px]:w-full h-[calc(var(--app-h,100dvh)-2rem)] flex flex-col bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0`}
      >
        {/* --- the head: a title, the window's tabs, the draft ------------ */}
        <div className={`flex flex-col gap-2.5 pt-5 pb-2.5 ${padX} max-[820px]:pt-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 font-serif text-2xl leading-tight">{title}</h2>
              {subtitle && <p className="m-0 mt-1 text-sm text-muted">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-1 flex-none">
              <OverflowMenu
                label="More about this deduction"
                items={[
                  { id: 'refresh', label: `Refresh from ${sourceId}`, onSelect: deduction.refresh, disabled: deduction.loading },
                  { id: 'reset', label: 'Reset the fine settings', onSelect: actions.resetSettings },
                  {
                    id: 'remove',
                    label: written ? `Remove the ${plural(written, 'stage')} Deduce added` : 'Remove what Deduce added',
                    onSelect: () => {
                      onWrite(removeDeduced(trip), false);
                      setDraft(EMPTY_DRAFT);
                      setPane('window');
                    },
                    disabled: written === 0,
                    danger: true,
                    title: 'Every stage this window ever wrote; places it gave your own stages stay. One undo step.',
                  },
                ]}
              />
              <button type="button" onClick={onCancel} aria-label="Close" className="w-8 h-8 border-0 bg-transparent text-xl leading-none text-muted cursor-pointer hover:text-ink">
                ×
              </button>
            </div>
          </div>
          {pane === 'window' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Segmented
                size="sm"
                label="Window"
                value={tab}
                onChange={(id) => goTo(id)}
                options={TABS.map((t) => ({ id: t.id, label: t.label, title: `${t.key} · ${t.sub}` }))}
              />
              <InfoDot about="the keys">
                <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                  {KEYS.map(([k, what]) => (
                    <span key={k} className="contents">
                      <kbd className="font-mono text-2xs text-ink-soft">{k}</kbd>
                      <span>{what}</span>
                    </span>
                  ))}
                </span>
              </InfoDot>
              <span className="flex-1" />
              {/* What was read, in one chip: the days placed, and what to check
                  — the detail, the source and its age are the Data pane's. */}
              <button
                type="button"
                onClick={() => setPane('data')}
                title={`${deduction.days.length} days · ${placed} placed${bySource ? ` (${bySource.track} by the ${polarsteps?.track?.origin === 'gpx' ? 'GPX' : 'Polarsteps'} track, ${bySource.instance} by ${sourceId}, ${bySource.step} by a step alone)` : ''} · ${blind} without position · ${sourceId}${ago !== null ? `, read ${ago === 0 ? 'just now' : `${ago} min ago`}` : ''}`}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-line bg-transparent font-mono text-2xs text-ink-soft cursor-pointer hover:border-line-strong hover:text-ink"
              >
                <i className={`w-1.5 h-1.5 rounded-full ${flaws.length ? 'bg-warn' : 'bg-ok'}`} aria-hidden="true" />
                {placed}/{deduction.days.length} days
                {flaws.length ? <span className="text-warn">· {plural(flaws.length, 'thing', 'things')} to check</span> : null}
              </button>
              <PolarstepsChip
                value={polarsteps}
                tripStart={trip.startDate}
                tripEnd={trip.endDate}
                error={polarError}
                onFiles={(files) => void readPolarsteps(files)}
                onClear={() => {
                  polarRef.current = null;
                  setPolarsteps(null);
                  setPolarError(null);
                }}
              />
              {draftParts.length > 0 && (
                <span
                  className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-full border border-line font-mono text-2xs text-ink-soft"
                  title={`The draft every window reads: ${draftParts.join(' · ')}`}
                >
                  {plural(size.answers + size.edits + size.names, 'change')}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(EMPTY_DRAFT);
                      setEditing(null);
                    }}
                    aria-label="Clear the draft"
                    title="Clear the draft — back to the safe verbs"
                    className="w-5 h-5 inline-grid place-items-center rounded-full border-0 bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* --- the body: the window, or a pane ----------------------------- */}
        {/* A SIZE container: the grain's map column reads its height (`cqh`). */}
        <div ref={bodyRef} className={`flex-1 min-h-0 overflow-auto [container-type:size] flex flex-col gap-3.5 pt-3 pb-4 ${padX} [&>*]:flex-none`}>
          {deduction.problem && polarsteps && deduction.track && (
            <p className="m-0 font-mono text-xs text-warn" role="status">
              {deduction.problem.text} Deducing from {polarsteps.track?.origin === 'gpx' ? (polarsteps.trip ? 'Polarsteps and GPX' : 'GPX') : 'Polarsteps'} alone.
            </p>
          )}
          {deduction.problem && !deduction.track ? (
            <p className="m-0 text-sm text-danger" role="alert">
              {deduction.problem.text}{' '}
              {deduction.problem.login && (
                <a className="font-semibold underline underline-offset-[3px]" href={deduction.problem.login} target="_blank" rel="noreferrer">
                  Sign in there
                </a>
              )}
            </p>
          ) : deduction.track === null || deduction.cities === null ? (
            <p className="m-0 font-mono text-xs text-muted">asking {sourceId}…</p>
          ) : pane === 'review' ? (
            <>
              {roadOffer && (
                <label className="flex items-start gap-2.5 px-3 py-2.5 border border-line rounded-paper bg-paper cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepRoad}
                    onChange={(e) => setKeepRoad(e.target.checked)}
                    className="mt-1 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 text-sm">
                    <b className="font-medium">Keep the road from {roadSourceText(roadSource)}</b>{' '}
                    <InfoDot about="the road">
                      <p>The track becomes the line the openers drive and the kilometres they count. Your places stay as they are.</p>
                      <p>It is kept whole, home and work included, and travels in the backup; Trip settings → Road chooses how it is read.</p>
                    </InfoDot>
                    <span className="block font-mono text-2xs text-muted">
                      {roadOffer.fixes.toLocaleString('en-GB')} fixes · {Math.round(roadOffer.km).toLocaleString('en-GB')} km {roadOffer.read}
                      {trip.road ? ' · replaces the road kept' : ''}
                    </span>
                  </span>
                </label>
              )}
              <ReviewPane ctx={ctx} outcome={outcome} />
            </>
          ) : pane === 'done' && lastRun ? (
            <DonePane ctx={ctx} outcome={lastRun} />
          ) : pane === 'data' ? (
            <DataPane ctx={ctx} />
          ) : tab === 'grain' ? (
            <GrainWindow ctx={ctx} />
          ) : tab === 'calque' ? (
            <CalqueWindow ctx={ctx} />
          ) : (
            <DeckWindow ctx={ctx} />
          )}
        </div>

        {/* --- the foot: one sentence, and the verbs ----------------------- */}
        <div className={`flex flex-wrap items-center justify-between gap-2.5 py-3 border-t border-line ${padX} max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]`}>
          <span className="text-xs text-ink-soft min-w-0 grow basis-[14rem]">
            {pane === 'review'
              ? `${plural(outcome.adds.length, 'stage')} added, ${outcome.completes.length} completed, ${outcome.left.length} left out.`
              : pane === 'done' && lastRun
                ? ''
                : pane === 'data'
                  ? 'Nothing here is written to the instance.'
                  : summary}
          </span>
          <span className="flex items-center gap-2 ml-auto">
            {pane === 'window' && (
              <>
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={!canWrite} onClick={() => setPane('review')}>
                  Review {toWrite || ''}
                </Button>
              </>
            )}
            {pane === 'review' && (
              <>
                <Button variant="ghost" onClick={() => setPane('window')}>
                  Back
                </Button>
                <Button variant="primary" disabled={!canWrite} onClick={write}>
                  Write {toWrite || ''}
                </Button>
              </>
            )}
            {pane === 'done' && (
              <>
                {onUndo && (
                  <Button
                    variant="danger"
                    disabled={!canUndo}
                    onClick={() => {
                      onUndo();
                      setLastRun(null);
                      setPane('window');
                    }}
                  >
                    Undo
                  </Button>
                )}
                <Button onClick={() => setPane('window')}>Run again</Button>
                <Button variant="primary" onClick={onCancel}>
                  Close
                </Button>
              </>
            )}
            {pane === 'data' && (
              <Button variant="primary" onClick={() => setPane('window')}>
                Back
              </Button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
