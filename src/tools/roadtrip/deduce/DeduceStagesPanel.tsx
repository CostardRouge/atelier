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
  type DeduceDraft,
  type DraftOutcome,
} from '../../../shared/roadtrip/deduce-draft';
import type { TripDoc } from '../../../shared/roadtrip/trip-types';
import type { WinnowConnection } from '../../../shared/sources/winnow/store';
import Button from '../../../shared/ui/Button';
import OverflowMenu from '../../../shared/ui/OverflowMenu';
import Segmented from '../../../shared/ui/Segmented';
import useDialogKeys from '../../../shared/ui/use-dialog-keys';
import CalqueWindow, { visibleUnder } from './CalqueWindow';
import DeckWindow from './DeckWindow';
import GrainWindow from './GrainWindow';
import { DataPane, DonePane, ReviewPane } from './panes';
import { plural } from './pieces';
import { DEFAULT_SETTINGS, readSettings, readTab, writeSettings, writeTab, type DeduceSettings, type DeduceTab } from './settings';
import { useDeduction } from './use-deduction';
import type { DeduceActions, DeduceContext, DeduceIntent } from './context';

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
  { id: 'grain', key: 'A', label: 'Le grain', sub: 'One grain for the whole trip; each stage then has its own verb and its own pencil.' },
  { id: 'calque', key: 'B', label: 'Le calque', sub: 'What your pictures say, laid under the stages you already have. Say what you want first.' },
  { id: 'paquet', key: 'C', label: 'Le paquet', sub: 'One chapter at a time. Your answer moves to the next; the safe one is marked.' },
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
  const bodyRef = useRef<HTMLDivElement>(null);

  const deduction = useDeduction(connection, trip, settings, draft);
  const { proposals, sourceId } = deduction;

  const outcome = useMemo(() => draftOutcome(proposals, draft, { sourceId, now: 0 }), [proposals, draft, sourceId]);
  const toWrite = outcome.adds.length + outcome.completes.length;

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
    el.scrollIntoView({ block: 'center' });
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

  function write() {
    const now = Date.now();
    const out = draftOutcome(proposals, draft, { sourceId, now });
    const applied = applyDraft(trip, out, now);
    onWrite(applied.trip, applied.spanWidened);
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
          next?.focus();
          next?.scrollIntoView({ block: 'nearest' });
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
      pane === 'window' && toWrite > 0 ? () => setPane('review') : pane === 'review' && toWrite > 0 ? write : pane === 'done' ? onCancel : null,
  });

  const ctx: DeduceContext = { trip, deduction, draft, settings, hot, flash, editing, intent, index, actions };
  const size = draftSize(draft);
  const draftParts = [size.answers ? plural(size.answers, 'verb') : '', size.edits ? plural(size.edits, 'edit') : '', size.names ? plural(size.names, 'name') : ''].filter(Boolean);
  const current = TABS.find((t) => t.id === tab)!;
  const written = deducedStages(trip).length;
  const flaws = [
    deduction.outliers.length ? `${plural(deduction.outliers.length, 'outlier')} ${settings.ignoreOutliers ? 'ignored' : 'kept'}` : '',
    (() => {
      const n = deduction.chapters.flatMap((c) => c.halts).filter((h) => !h.city).length;
      return n ? plural(n, 'unnamed halt') : '';
    })(),
  ].filter(Boolean);
  const placed = deduction.track?.points.length ?? 0;
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
          : current.sub;

  const summary = toWrite
    ? `${outcome.adds.length ? `adds ${plural(outcome.adds.length, 'stage')}` : ''}${outcome.adds.length && outcome.completes.length ? ', ' : ''}${outcome.completes.length ? `completes ${plural(outcome.completes.length, 'stage')}` : ''}. Nothing is written before Review.`
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
      <div className="w-full max-w-[54rem] h-[calc(var(--app-h,100dvh)-2rem)] flex flex-col bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0">
        {/* --- the head: a title, the window's tabs, the draft ------------ */}
        <div className={`flex flex-col gap-2.5 pt-5 pb-2.5 ${padX} max-[820px]:pt-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 font-serif text-2xl leading-tight">{title}</h2>
              <p className="m-0 mt-1 text-sm text-muted">{subtitle}</p>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                size="sm"
                label="Window"
                value={tab}
                onChange={(id) => goTo(id)}
                options={TABS.map((t) => ({
                  id: t.id,
                  label: (
                    <>
                      <span className="font-mono text-3xs opacity-70 mr-1">{t.key}</span>
                      {t.label}
                    </>
                  ),
                }))}
              />
              <span
                className={`inline-flex items-center gap-2 max-w-full pl-2.5 pr-1 py-0.5 rounded-full border border-line font-mono text-2xs ${draftParts.length ? 'text-ink-soft' : 'text-muted'}`}
                title="The draft every window reads"
              >
                <i className={`w-1.5 h-1.5 rounded-full flex-none ${draftParts.length ? 'bg-accent' : 'bg-line-strong'}`} aria-hidden="true" />
                {draftParts.length ? `Draft · ${draftParts.join(' · ')}` : 'No draft yet · the safe verbs stand'}
                <button
                  type="button"
                  disabled={!draftParts.length}
                  onClick={() => {
                    setDraft(EMPTY_DRAFT);
                    setEditing(null);
                  }}
                  className="px-1.5 py-px rounded-full border-0 bg-transparent font-sans text-2xs font-medium text-muted cursor-pointer hover:bg-paper-2 hover:text-ink disabled:opacity-40 disabled:cursor-default"
                >
                  Clear
                </button>
              </span>
            </div>
          )}
        </div>

        {/* --- the strip: what was read, and what is wrong with it --------- */}
        {pane === 'window' && (
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 border-b border-line text-2xs text-muted ${padX}`}>
            <span className="font-mono text-ink-soft tabular-nums">
              {deduction.days.length} days · {placed} placed · {blind} without position
            </span>
            <button
              type="button"
              onClick={() => setPane('data')}
              className={`inline-flex items-center gap-1.5 p-0 border-0 bg-transparent font-sans text-2xs font-medium cursor-pointer ${flaws.length ? 'text-warn' : 'text-ok'}`}
            >
              <i className={`w-1.5 h-1.5 rounded-full ${flaws.length ? 'bg-warn' : 'bg-ok'}`} aria-hidden="true" />
              {flaws.length ? flaws.join(' · ') : 'nothing to fix'} →
            </button>
            <span className="ml-auto">
              {sourceId}
              {ago !== null ? ` · read ${ago === 0 ? 'just now' : `${ago} min ago`}` : deduction.loading ? ' · reading…' : ''}
            </span>
          </div>
        )}

        {/* --- the body: the window, or a pane ----------------------------- */}
        <div ref={bodyRef} className={`flex-1 min-h-0 overflow-auto flex flex-col gap-3.5 pt-3 pb-4 ${padX} [&>*]:flex-none`}>
          {deduction.problem ? (
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
            <ReviewPane ctx={ctx} outcome={outcome} />
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
                ? `${plural(lastRun.adds.length, 'stage')} added, ${lastRun.completes.length} completed.`
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
                <Button variant="primary" disabled={toWrite === 0} onClick={() => setPane('review')}>
                  Review {toWrite || ''}
                </Button>
              </>
            )}
            {pane === 'review' && (
              <>
                <Button variant="ghost" onClick={() => setPane('window')}>
                  Back
                </Button>
                <Button variant="primary" disabled={toWrite === 0} onClick={write}>
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
