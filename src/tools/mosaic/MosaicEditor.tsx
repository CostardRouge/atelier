import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../../app/use-hash-route';
import {
  cleanMosaicTitle,
  sanitizeSettings,
  withMeasures,
  withPictures,
  type MosaicDoc,
  type MosaicSettings as Settings,
  type MosaicTile,
} from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import Button from '../../shared/ui/Button';
import EmptyState from '../../shared/ui/EmptyState';
import PageBar from '../../shared/ui/PageBar';
import { Icons } from '../../shared/ui/icons';
import { useElementSize } from '../../shared/ui/use-element-width';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import { runMeasure, type MeasureProgress } from './measure-pool';
import MosaicPicker from './MosaicPicker';
import MosaicSettings from './MosaicSettings';
import MosaicStage, { type StageView } from './MosaicStage';
import MosaicTransport from './MosaicTransport';
import { MosaicPlayer, type PlayerStatus } from './mosaic-player';
import { pictureCountLine } from './MosaicGallery';
import { useMosaicCover } from './use-mosaic-cover';
import { randomTarget, useMosaicScene } from './use-mosaic-scene';

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
 * The stage and its dials, mounted only once the mosaic has pictures: the
 * room is measured on THIS element, so the stage gets its size the moment
 * it exists (a size hook on the editor measured nothing, the box not being
 * there yet).
 */
function MosaicWorkbench({
  doc,
  client,
  update,
  setTarget,
}: {
  doc: MosaicDoc;
  client: WinnowClient | null;
  update: (fn: (s: Settings) => Settings) => void;
  setTarget: (id: number) => void;
}) {
  const [boxRef, room] = useElementSize<HTMLDivElement>();
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // The widest 16:9 the room holds, never taller than it.
  const stageW = Math.floor(Math.min(room.width, (room.height || Infinity) * (16 / 9)));
  const stageH = Math.floor(stageW * (9 / 16));
  const { state, builder } = useMosaicScene({ doc, client, stageW, stageH, dpr });
  useMosaicCover(doc.id, state);
  const [view, setView] = useState<StageView>({ grid: false, ghost: 0 });

  // --- the player: the animated modes over the builder's scenes ---
  const player = useMemo(() => (builder ? new MosaicPlayer(builder) : null), [builder]);
  const [status, setStatus] = useState<PlayerStatus>({ playing: false, current: -1, stepIndex: 0, phase: '', waiting: false, error: null });
  useEffect(() => {
    if (!player) return;
    const unsubscribe = player.subscribe(setStatus);
    return () => {
      unsubscribe();
      player.stop();
    };
  }, [player]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasOut = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
  }, []);
  useEffect(() => {
    player?.attach(canvasRef.current, { stageW, stageH, dpr });
  }, [player, stageW, stageH, dpr, status.playing]);

  const { mode, direction, speed, seed, cellPx, level, space, tint, distinctNeighbours } = doc.settings;
  const play = useCallback(() => {
    if (!player || mode === 'single' || doc.target === undefined || player.playing) return;
    player.attach(canvasRef.current, { stageW, stageH, dpr });
    player.start({ mode, direction, speed, seed, settings: { cellPx, level, space, tint, distinctNeighbours }, from: doc.target, grid: view.grid });
  }, [player, mode, direction, speed, seed, cellPx, level, space, tint, distinctNeighbours, doc.target, view.grid, stageW, stageH, dpr]);
  const stop = useCallback(() => player?.stop(), [player]);
  // When a run ends — Stop, Escape, a pull-back once done — the picture on screen is the target now.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !status.playing && status.current >= 0 && status.current !== doc.target) setTarget(status.current);
    wasPlaying.current = status.playing;
  }, [status.playing, status.current, doc.target, setTarget]);
  // A mode or a dial changed under a running player: the run stops, the next Play takes them.
  const dialsKey = `${mode}|${direction}|${cellPx}|${level}|${space}|${tint}|${distinctNeighbours}`;
  const lastDials = useRef(dialsKey);
  useEffect(() => {
    if (lastDials.current === dialsKey) return;
    lastDials.current = dialsKey;
    player?.stop();
  }, [dialsKey, player]);

  // Space plays and stops (the transport's key); Escape stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape' && status.playing) {
        e.preventDefault();
        stop();
      } else if (e.key === ' ' && mode !== 'single') {
        e.preventDefault();
        if (status.playing) stop();
        else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status.playing, mode, play, stop]);

  const fullscreen = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }, [boxRef]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 @min-[860px]:grid @min-[860px]:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-h-0 min-w-0 flex flex-col gap-3">
        <div ref={boxRef} className="min-h-[200px] flex-1 min-w-0 flex items-start justify-center [&:fullscreen]:items-center [&:fullscreen]:bg-frame">
          <div style={{ width: stageW || undefined, height: stageH || undefined }}>
            <MosaicStage
              state={state}
              view={view}
              stageW={stageW}
              stageH={stageH}
              dpr={dpr}
              playing={status.playing}
              canvasOut={canvasOut}
              onPick={(index) => state.status === 'ready' && setTarget(state.scene.tiles[index].id)}
            />
          </div>
        </div>
        <MosaicTransport
          mode={mode}
          direction={direction}
          setMode={(m) => update((s) => ({ ...s, mode: m }))}
          setDirection={(d) => update((s) => ({ ...s, direction: d }))}
          status={status}
          canPlay={Boolean(player) && doc.target !== undefined && state.status !== 'idle'}
          onPlay={play}
          onStop={stop}
          onFullscreen={fullscreen}
        />
      </div>
      <aside className="min-h-0 overflow-auto" aria-label="Mosaic settings">
        <MosaicSettings settings={doc.settings} update={update} view={view} setView={setView} state={state} />
      </aside>
    </div>
  );
}

/**
 * Mosaic — WORK IN PROGRESS. One MOSAIC (`shared/mosaic/mosaic-doc.ts`): its
 * library of pictures from one Winnow, each measured once, and the picture
 * rebuilt out of them. Built so far (`docs/mosaic.md`): the frame (M3), the
 * door — the shared picker adds references, every add starts a measuring run
 * (M4) — and the stage in SINGLE mode: the target rebuilt out of the
 * library, its dials beside it, a click on a cell making its picture the
 * target (M5). The animated modes (M6) follow.
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

  // --- the target: the picture rebuilt; the first measured one until a click or a draw says otherwise ---
  const measuredCount = doc.tiles.filter((t) => t.grid).length;
  const salt = useRef(0);
  useEffect(() => {
    if (doc.target !== undefined || !measuredCount) return;
    const id = randomTarget(doc, salt.current++);
    if (id !== undefined) change((d) => ({ ...d, target: id, updatedAt: Date.now() }));
  }, [doc, measuredCount, change]);
  const setTarget = useCallback((id: number) => change((d) => (d.target === id ? d : { ...d, target: id, updatedAt: Date.now() })), [change]);

  const update = useCallback((fn: (s: Settings) => Settings) => change((d) => ({ ...d, settings: sanitizeSettings(fn(d.settings)), updatedAt: Date.now() })), [change]);

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
        {measuredCount > 1 && (
          <Button
            size="sm"
            variant="ghost"
            icon={Icons.swap}
            onClick={() => {
              const id = randomTarget(doc, salt.current++);
              if (id !== undefined) setTarget(id);
            }}
            title="Another picture of the library as the target — or click a cell on the stage"
          >
            Draw a target
          </Button>
        )}
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
      {doc.tiles.length === 0 ? (
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
      ) : (
        <MosaicWorkbench doc={doc} client={client} update={update} setTarget={setTarget} />
      )}
    </section>
  );
}
