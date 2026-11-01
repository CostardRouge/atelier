import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../../app/use-hash-route';
import { cleanMosaicTitle, withMeasures, withPictures, type MosaicDoc, type MosaicTile } from '../../shared/mosaic/mosaic-doc';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import Button from '../../shared/ui/Button';
import EmptyState from '../../shared/ui/EmptyState';
import PageBar from '../../shared/ui/PageBar';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import { runMeasure, type MeasureProgress } from './measure-pool';
import MosaicPicker from './MosaicPicker';
import { pictureCountLine } from './MosaicGallery';

/** Where the editor's save stands, as its bar says it. */
export type SaveState = 'saved' | 'saving' | 'failed';

const SAVE_WORDS: Record<SaveState, string> = { saved: 'Saved', saving: 'Saving…', failed: 'Not saved' };

interface MosaicEditorProps {
  doc: MosaicDoc;
  /** Every edit, through one funnel — the shell saves it. */
  change: (fn: (doc: MosaicDoc) => MosaicDoc) => void;
  saveState: SaveState;
  onBack: () => void;
  /** Drawn under the bar: another tab edits this mosaic. */
  band?: ReactNode;
}

/** The tiles a run must still settle: no grid yet, or a failure to try again. */
function unmeasured(doc: MosaicDoc, retryFailed: boolean): MosaicTile[] {
  return doc.tiles.filter((t) => !t.grid && (retryFailed || !t.failed));
}

/**
 * Mosaic — WORK IN PROGRESS. One MOSAIC (`shared/mosaic/mosaic-doc.ts`): its
 * library of pictures from one Winnow, each measured once, and the picture
 * rebuilt out of them. Built so far (`docs/mosaic.md`): the frame (M3) and
 * the door — the shared picker adds references, and every add starts a
 * measuring run whose grids land on the document (M4). The stage (M5) and
 * the animated modes (M6) follow.
 */
export default function MosaicEditor({ doc, change, saveState, onBack, band }: MosaicEditorProps) {
  useSurface('darkroom');
  const compact = useIsCompact();
  const { connection, client } = useWinnowConnection();
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);

  const commitTitle = () => {
    const clean = cleanMosaicTitle(title);
    if (clean && clean !== doc.title) change((d) => ({ ...d, title: clean, updatedAt: Date.now() }));
    else setTitle(doc.title);
  };

  // --- measuring: one run at a time, its grids written onto the document as it ends ---
  const [progress, setProgress] = useState<MeasureProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const changeRef = useRef(change);
  changeRef.current = change;

  const measure = useCallback(
    async (retryFailed: boolean) => {
      const cur = docRef.current;
      if (running.current || !client || !connection || !cur.instance || cur.instance !== connection.id) return;
      const todo = unmeasured(cur, retryFailed);
      if (!todo.length) return;
      const controller = new AbortController();
      running.current = controller;
      setNotice(null);
      try {
        const result = await runMeasure(client, cur.instance, todo, { signal: controller.signal, onProgress: setProgress });
        changeRef.current((d) => withMeasures(d, result.grids, result.failed));
        if (result.failed.length) setNotice(`${result.failed.length} picture${result.failed.length === 1 ? '' : 's'} could not be read from ${connection.id} — skipped; Measure again tries them once more.`);
        else if (result.cancelled) setNotice('Measuring stopped; what was measured is kept.');
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        running.current = null;
        setProgress(null);
      }
    },
    [client, connection],
  );

  // A mosaic opened with pictures still unmeasured (a cancelled run, an import on another device) resumes by itself.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (unmeasured(doc, false).length) void measure(false);
  }, [doc, measure]);
  useEffect(() => () => running.current?.abort(), []);

  const onAdd = useCallback(
    (tiles: MosaicTile[], instance: string, span: { from: string; to: string } | undefined) => {
      change((d) => withPictures(d, tiles, instance, span));
      // The document above is applied synchronously through the shell's `change`; the run reads it from the ref.
      queueMicrotask(() => void measure(false));
    },
    [change, measure],
  );

  const failed = doc.tiles.filter((t) => t.failed).length;
  const pending = unmeasured(doc, false).length;
  const canMeasure = Boolean(client && connection && doc.instance === connection.id) && !progress;

  return (
    <section className="@container flex-1 min-h-0 flex flex-col gap-3" aria-label="Mosaic">
      <PageBar
        back={{ label: 'Mosaics', onClick: onBack, iconOnly: compact }}
        trailing={
          <span
            className={`font-mono text-2xs ${saveState === 'failed' ? 'text-danger' : 'text-muted'}`}
            role="status"
            title={
              saveState === 'failed'
                ? 'The browser refused to store this mosaic (a private window, or the disk is full) — your edits are still on screen.'
                : 'Every change is kept on this device as you go.'
            }
          >
            {SAVE_WORDS[saveState]}
          </span>
        }
      >
        <input
          aria-label="Mosaic title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(doc.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={`min-w-0 flex-1 h-9 px-2 rounded-control border border-transparent bg-transparent font-serif text-ink hover:border-line focus:border-line-strong focus:bg-paper focus:outline-none ${compact ? 'text-lg' : 'text-2xl'}`}
        />
      </PageBar>
      {band}
      <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        <span className="font-mono text-2xs text-muted tabular-nums" role="status">
          {progress
            ? `measuring ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}…`
            : `${pictureCountLine(doc)}${failed ? ` · ${failed} skipped` : ''}`}
        </span>
        <span className="flex-1" />
        {!progress && (pending > 0 || failed > 0) && (
          <Button size="sm" variant="ghost" disabled={!canMeasure} onClick={() => void measure(pending === 0)} title={pending ? `Read the colours of ${pending} picture${pending === 1 ? '' : 's'} not measured yet` : 'Try the skipped pictures once more'}>
            {pending ? `Measure ${pending.toLocaleString()}` : 'Measure again'}
          </Button>
        )}
        {connection && client ? (
          <MosaicPicker doc={doc} connection={connection} client={client} onAdd={onAdd} />
        ) : (
          <Button size="sm" variant="ghost" onClick={() => navigate('/sources')} title="A mosaic takes its pictures from a connected Winnow">
            Connect a Winnow
          </Button>
        )}
      </div>
      {notice && (
        <p className="m-0 text-xs text-ink-soft" role="status">
          {notice}
        </p>
      )}
      {doc.tiles.length === 0 && (
        <EmptyState
          title="No pictures yet"
          actions={
            connection && client ? (
              <MosaicPicker doc={doc} connection={connection} client={client} onAdd={onAdd} />
            ) : (
              <Button variant="primary" onClick={() => navigate('/sources')}>
                Connect a Winnow
              </Button>
            )
          }
        >
          A mosaic starts with pictures from your Winnow — a span of days, hundreds or thousands of them. Each is measured once and kept
          here with its colours.
        </EmptyState>
      )}
    </section>
  );
}
