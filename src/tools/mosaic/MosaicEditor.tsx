import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../../app/use-hash-route';
import {
  QUEUE_REFILL_AT,
  chainAdvanced,
  chainOf,
  cleanMosaicTitle,
  queueInsert,
  queueRemove,
  queueSet,
  queueShuffle,
  refillQueue,
  sanitizeSettings,
  withChainDraw,
  withCrop,
  withMeasures,
  withPictures,
  withTarget,
  type MosaicDoc,
  type MosaicSettings as Settings,
  type MosaicTile,
} from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import type { Crop, Rect } from '../../shared/mosaic/frame';
import { describeZoomKey, zoomKeyAction } from '../../shared/ui/zoom-keys';
import { motionOf, recipeOf, type Recipe } from '../../shared/mosaic/motion';
import Button from '../../shared/ui/Button';
import EmptyState from '../../shared/ui/EmptyState';
import PageBar from '../../shared/ui/PageBar';
import InspectorBlock, { BLOCK_TABS } from '../../shared/ui/InspectorBlock';
import PanelHost from '../../shared/ui/PanelHost';
import Segmented from '../../shared/ui/Segmented';
import PhoneHeader from '../../shared/ui/PhoneHeader';
import type { OverflowItem } from '../../shared/ui/OverflowMenu';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { usePublishShellChrome } from '../../shared/ui/shell-chrome';
import { Icons } from '../../shared/ui/icons';
import useEditorKeys from '../../shared/ui/use-editor-keys';
import { useElementSize } from '../../shared/ui/use-element-width';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import ChainBand from './ChainBand';
import { runMeasure, type MeasureProgress } from './measure-pool';
import MosaicPicker from './MosaicPicker';
import MosaicSettings, { SETTINGS_TABS, type SettingsTab } from './MosaicSettings';
import MosaicExportPanel, { MosaicDeliver } from './MosaicExportPanel';
import { useMosaicExport } from './use-mosaic-export';
import { useMosaicEditorCommands, useMosaicStageCommands } from './use-mosaic-commands';
import MosaicStage, { type Reveal, type StageView, type ZoomDetail } from './MosaicStage';
import { SharpPictures } from './sharp-pictures';
import MosaicTransport from './MosaicTransport';
import TargetChooser from './TargetChooser';
import TargetFrame from './TargetFrame';
import { MatchPool } from './match-pool';
import { IDLE_STATUS, MosaicPlayer, type PlayerStatus } from './mosaic-player';
import { MOSAIC_PERF_PREF, motionReduced, useMosaicPerf, workersHere } from './use-mosaic-perf';
import { pictureCountLine } from './MosaicGallery';
import { useMosaicCover } from './use-mosaic-cover';
import { randomTarget, useMosaicScene, type MosaicScene } from './use-mosaic-scene';
import { useStageZoom } from './use-stage-zoom';
import TargetStepsControl from './TargetStepsControl';
import { useTargetSteps, type TargetSteps } from './use-target-steps';

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
  /** The history's two buttons, beside the save word. */
  headerExtra?: ReactNode;
  /** The sync pill, for a mosaic kept on an instance (M8). */
  syncPill?: ReactNode;
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
  change: rawChange,
  update,
  setTarget,
  setCrop,
  steps,
  compact,
  header,
  latest,
}: {
  doc: MosaicDoc;
  client: WinnowClient | null;
  change: (fn: (doc: MosaicDoc) => MosaicDoc) => void;
  update: (fn: (s: Settings) => Settings) => void;
  setTarget: (id: number) => void;
  setCrop: (crop: Crop | undefined) => void;
  /** Previous and next over the targets visited — the arrows on the stage. */
  steps: TargetSteps;
  /** A phone: one column, the settings a tab at a time in a drawer under the stage. */
  compact: boolean;
  /** A phone's header, drawn by the editor with this screen's own verbs added to its ⋯. */
  header: (extra: OverflowItem[]) => ReactNode;
  /** The mosaic as the editor last wrote it — what an agent's command reads before the next render. */
  latest: { current: MosaicDoc };
}) {
  const [boxRef, measuredRoom] = useElementSize<HTMLDivElement>();
  // On a phone the settings open one tab at a time in a drawer that takes a share of the column (`PanelHost`).
  const [tab, setTab] = useState<SettingsTab>('target');
  const [tabOpen, setTabOpen] = useState(false);
  // While the drawer is up the stage is SHOWN smaller but BUILT for the room it had: a drawer opened to turn a dial
  // must not rebuild the mosaic at another cell count — the dial's own change does that, once.
  const freeRoom = useRef(measuredRoom);
  const held = compact && tabOpen;
  if (!held) freeRoom.current = measuredRoom;
  const room = held ? freeRoom.current : measuredRoom;
  // The Performance panel's say (this device's), the matching pool it sizes, and where a propagation starts.
  const [perf, setPerf] = useMosaicPerf();
  const workers = workersHere(perf);
  const pool = useMemo(() => new MatchPool(workers), [workers]);
  useEffect(() => () => pool.dispose(), [pool]);
  const [origin, setOrigin] = useState(-1);
  const [fps, setFps] = useState<number | null>(null);
  const reduced = motionReduced(perf);
  const reveal = useMemo<Reveal>(() => ({ animation: reduced ? 'none' : perf.cellAnimation, ms: perf.animationMs }), [reduced, perf.cellAnimation, perf.animationMs]);
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // A zoom that became the crop: what the next build starts from (F6).
  const [carry, setCarry] = useState<{ scene: MosaicScene; window: Rect } | null>(null);
  // The stage is the widest frame of the mosaic's shape the room holds — the picture's own shape for `original`.
  const { state, builder, stageW, stageH, frameAspect: aspect } = useMosaicScene({ doc, client, room, dpr, pool, perf, origin, carry });
  useMosaicCover(doc.id, state);
  const [view, setView] = useState<StageView>({ grid: false, ghost: 0 });
  // What the chooser is for: the target, an entry of the chain in place, or one more at its end.
  const [choosing, setChoosing] = useState<null | { for: 'target' } | { for: 'replace'; at: number } | { for: 'insert' }>(null);
  const measured = useMemo(() => doc.tiles.filter((t) => t.grid), [doc.tiles]);
  // The target's picture for its card: the scene's own once it is this target's.
  const shown = state.status === 'ready' ? state.scene : state.status === 'idle' ? null : state.previous;
  const targetBitmap = shown && shown.targetId === doc.target ? shown.target : null;

  // --- the player: the animated modes over the builder's scenes ---
  const player = useMemo(() => (builder ? new MosaicPlayer(builder) : null), [builder]);
  const [status, setStatus] = useState<PlayerStatus>(IDLE_STATUS);
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

  const { mode, motion, speed, seed, cellPx, level, space, tint, distinctNeighbours } = doc.settings;

  // --- the chain's queue (lab 2, R6): in the document, read by the player as it prepares each step ---
  const chain = chainOf(doc);
  // Every animated recipe walks the queue (lab 3): a reveal and a drift move on to the next picture too.
  const chained = mode !== 'single';
  // The document as it is NOW, written the moment an edit is applied — not at the next render: the player reads the
  // queue right after a steer writes it, before React has drawn anything.
  const docRef = useRef(doc);
  docRef.current = doc;
  const change = useCallback(
    (fn: (d: MosaicDoc) => MosaicDoc) =>
      rawChange((d) => {
        const next = fn(d);
        docRef.current = next;
        return next;
      }),
    [rawChange],
  );
  const queueSource = useMemo(
    () => ({
      next: (index: number) => chainOf(docRef.current).queue[index]?.id,
      draw: chain.draw,
      onDraw: (index: number, id: number) => change((d) => queueSet(d, index, id, 'draw')),
      onPick: (index: number, id: number) => change((d) => queueSet(d, index, id, 'pick')),
      picked: (index: number) => chainOf(docRef.current).queue[index]?.by === 'pick',
    }),
    [chain.draw, change],
  );
  // Under five ahead, the queue refills itself from the seed — by colour, over the library the builder holds.
  const ahead = chain.queue.length - (status.playing ? status.done : 0);
  const canRefill = chained && chain.draw && Boolean(builder) && measured.length >= 2 && doc.target !== undefined && ahead < QUEUE_REFILL_AT;
  useEffect(() => {
    if (!canRefill || !builder) return;
    const done = status.playing ? status.done : 0;
    change((d) => refillQueue(d, builder.labGrids(), builder.tiles, done));
    // `ahead` and the target are what decide a refill; the rest is read when it runs.
  }, [canRefill, builder, change, status.playing, status.done, doc.target]);

  const play = useCallback(() => {
    if (!player || mode === 'single' || doc.target === undefined || player.playing) return;
    player.attach(canvasRef.current, { stageW, stageH, dpr });
    player.start({ mode, motion, speed, seed, settings: { cellPx, level, space, tint, distinctNeighbours }, from: doc.target, grid: view.grid, crop: doc.crop, pool, queue: chained ? queueSource : undefined, ahead: perf.ahead });
  }, [player, mode, motion, speed, seed, cellPx, level, space, tint, distinctNeighbours, doc.target, doc.crop, view.grid, stageW, stageH, dpr, pool, chained, queueSource, perf.ahead]);
  const stop = useCallback(() => player?.stop(), [player]);
  // Writing it out (M7): the stage's own builder and pool, a player of the film's own, the queue read and never written.
  // While a run plays, the target card shows the picture whose mosaic is on screen (lab 4, L2): its bitmap from the
  // player's scene, the instance's thumbnail until that scene is built.
  const [onScreen, setOnScreen] = useState<{ id: number; bitmap: ImageBitmap | null } | null>(null);
  useEffect(() => {
    if (!status.playing || status.current < 0 || !player) {
      setOnScreen(null);
      return;
    }
    let alive = true;
    const id = status.current;
    setOnScreen((cur) => (cur?.id === id ? cur : { id, bitmap: null }));
    void player.pictureOf(id).then((bitmap) => {
      if (alive && bitmap) setOnScreen({ id, bitmap });
    });
    return () => {
      alive = false;
    };
  }, [status.playing, status.current, player]);
  /** The picture the target card shows: the one on screen while a run plays, else the target. */
  const cardId = onScreen ? onScreen.id : doc.target;
  const exporter = useMosaicExport({ doc, builder, pool, stageW, stageH, queue: chained ? queueSource : undefined });
  useMosaicStageCommands({ latest, rendered: doc, state, status, play, stop, canvas: () => canvasRef.current, exporter, update });
  // When a run ends — Stop, Escape, a pull-back once done — the picture on screen is the target now, and the steps played leave the queue.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !status.playing && status.current >= 0) change((d) => chainAdvanced(d, status.done, status.current));
    wasPlaying.current = status.playing;
  }, [status.playing, status.current, status.done, change]);
  // A mode or a dial changed under a running player: the run stops, the next Play takes them.
  const dialsKey = `${mode}|${JSON.stringify(motion)}|${cellPx}|${level}|${space}|${tint}|${distinctNeighbours}|${doc.settings.aspect}`;
  const lastDials = useRef(dialsKey);
  useEffect(() => {
    if (lastDials.current === dialsKey) return;
    lastDials.current = dialsKey;
    player?.stop();
  }, [dialsKey, player]);

  // Still is the editing state (lab 4, L1): the mode button keeps the recipe Play plays from it, and Play from Still
  // switches to that recipe, then plays once the render carries it — after the stop above, which a mode change runs.
  const lastRecipe = useRef<Recipe | 'custom'>(mode === 'single' ? recipeOf(motion) : mode);
  if (mode !== 'single') lastRecipe.current = mode;
  const pendingPlay = useRef(false);
  const playFrom = useCallback(() => {
    if (mode !== 'single') {
      play();
      return;
    }
    const r = lastRecipe.current;
    pendingPlay.current = true;
    update((s) => ({ ...s, mode: r, motion: r === 'custom' ? s.motion : motionOf(r, s.motion) }));
  }, [mode, play, update]);
  useEffect(() => {
    if (!pendingPlay.current || mode === 'single' || status.playing) return;
    pendingPlay.current = false;
    play();
  }, [mode, play, status.playing]);
  // Custom opens Motion where its parts are: the tab's drawer on a phone, the block's tab beside the stage.
  const openMotion = useCallback(() => {
    if (compact) {
      setTab('motion');
      setTabOpen(true);
      return;
    }
    setTab('motion');
  }, [compact]);

  // --- the zoom over the stage, whatever the mode while nothing plays: a crop with auto-frame, a look without (F6) ---
  // In every mode, not only Still: a stopped stage shows the target's mosaic, and a pinch the stage did not hear was
  // read by the browser, which zoomed the whole page instead.
  // What a zoom's cells are drawn from (lab 4, L4): the instance's sharper pictures as they grow, the veil fading —
  // under a zoom that LOOKS only: with Auto-frame the view lives for the gesture and the mosaic is rebuilt at ×1 on
  // release, so a fetch would be wasted and a fading veil would jump back.
  const sharpPictures = useMemo(() => (client ? new SharpPictures(client) : null), [client]);
  useEffect(() => sharpPictures?.open(), [sharpPictures]);
  const zoomDetail = useMemo<ZoomDetail | null>(
    () =>
      sharpPictures && perf.zoom === 'look'
        ? { pictures: sharpPictures, sharp: perf.sharpZoom, fade: perf.veilFade, sharpOf: (id, level) => sharpPictures.get(id, level), tileOf: (id) => builder?.tileOf(id) ?? null }
        : null,
    [sharpPictures, perf.zoom, perf.sharpZoom, perf.veilFade, builder],
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const zoom = useStageZoom({
    ref: stageRef,
    enabled: !status.playing,
    stageW,
    stageH,
    scene: shown,
    crop: doc.crop,
    meaning: perf.zoom,
    onCommit: (crop, carried) => {
      setCarry(carried);
      setCrop(crop);
    },
  });
  const cropped = Boolean(doc.crop);

  // Space plays and stops (the transport's key); Escape stops; Z fits the view, then the whole picture; the arrows pan
  // a kept zoom, or walk the targets visited. Who owns a press is `editor-keys.ts`'s call: a slider a drag left
  // focused keeps only its arrows, a button a click left focused keeps nothing, a sheet over the editor keeps all.
  useEditorKeys((k, e) => {
    if (k.name === 'escape') {
      if (!status.playing) return false;
      stop();
      return true;
    }
    if (k.name === 'space') {
      if (status.playing) stop();
      else playFrom();
      return true;
    }
    if (status.playing) return false;
    const action = zoomKeyAction(describeZoomKey(e), zoom.zoomed);
    // ← and → walk the targets visited while no zoom is kept (a kept zoom pans with them).
    if (!action && !zoom.zoomed && (k.name === 'left' || k.name === 'right')) {
      if (k.name === 'left') steps.back();
      else steps.forward();
      return true;
    }
    if (!action) return false;
    if (action.kind === 'toggle') {
      if (zoom.zoomed) zoom.fit();
      else if (cropped) setCrop(undefined);
    } else zoom.pan(action.dx, action.dy);
    return true;
  });

  const fullscreen = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }, [boxRef]);

  // The stage shown inside the room it has NOW, at the size it was built for or smaller (the drawer's share).
  const fit = stageW > 0 && stageH > 0 && measuredRoom.width > 0 && measuredRoom.height > 0 ? Math.min(1, measuredRoom.width / stageW, measuredRoom.height / stageH) : 1;
  const shownW = Math.floor(stageW * fit);
  const shownH = Math.floor(stageH * fit);

  usePublishSectionBar(
    useMemo(
      () =>
        compact
          ? {
              sections: SETTINGS_TABS,
              // Marked only while its drawer is up (`section-rail.tsx`).
              active: tabOpen ? tab : null,
              label: 'Mosaic settings',
              onSelect: (id: string) => {
                setTab(id as SettingsTab);
                setTabOpen(true);
              },
            }
          : null,
      [compact, tabOpen, tab],
    ),
  );

  const stage = (
    <div ref={stageRef} className="relative touch-none select-none" style={{ width: shownW || undefined, height: shownH || undefined }}>
      <MosaicStage
        state={state}
        view={view}
        stageW={stageW}
        stageH={stageH}
        dpr={dpr}
        reveal={reveal}
        onFps={setFps}
        zoom={zoom.view}
        playing={status.playing}
        canvasOut={canvasOut}
        swallowClick={zoom.justDragged}
        clickHost={stageRef}
        detail={zoomDetail ?? undefined}
        pannable={zoom.pannable}
        onPick={(index, cell) => {
          if (state.status !== 'ready') return;
          setOrigin(cell);
          // A pick at any zoom (lab 4, L3): the new picture opens whole, the view back to its fit.
          zoom.fit();
          setTarget(state.scene.tiles[index].id);
        }}
        onSteer={chained ? (cell) => void player?.steer(cell) : undefined}
      />
      {!status.playing && (zoom.zoomed || cropped) && (
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-control bg-frame/75 p-1" role="group" aria-label="Zoom">
          {zoom.zoomed && (
            <span className="font-mono text-2xs text-on-media tabular-nums px-1" role="status">
              ×{zoom.view.s.toFixed(zoom.view.s < 10 ? 1 : 0)}
            </span>
          )}
          {zoom.zoomed && perf.zoom === 'look' && (
            <Button size="sm" variant="primary" onClick={zoom.commit} title="What is in view becomes the part rebuilt, with as many cells on it — Auto-frame does it on release">
              Frame this
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={Icons.zoomFit} onClick={() => (zoom.zoomed ? zoom.fit() : setCrop(undefined))} title={zoom.zoomed ? 'Back to the mosaic as built (Z)' : 'Rebuild the whole picture (Z)'}>
            {zoom.zoomed ? 'Fit' : 'Whole'}
          </Button>
        </div>
      )}
    </div>
  );
  const band =
    chained && doc.instance ? (
      <ChainBand
        instance={doc.instance}
        client={client}
        current={status.playing && status.current >= 0 ? status.current : doc.target}
        queue={chain.queue}
        done={status.done}
        playing={status.playing}
        waiting={status.waiting && status.stepIndex > 0}
        draw={chain.draw}
        setDraw={(v) => change((d) => withChainDraw(d, v))}
        onReplace={(at) => setChoosing({ for: 'replace', at })}
        onInsert={() => setChoosing({ for: 'insert' })}
        onRemove={(at) => change((d) => queueRemove(d, at))}
        onShuffle={() => change((d) => queueShuffle(d))}
        compact={compact}
      />
    ) : null;
  const transport = (
    <MosaicTransport
      mode={mode}
      motion={motion}
      recipe={mode === 'single' ? lastRecipe.current : mode}
      scene={shown}
      onStill={() => update((s) => ({ ...s, mode: 'single' }))}
      onPickRecipe={(r) => update((s) => ({ ...s, mode: r, motion: motionOf(r, s.motion) }))}
      onCustom={() => {
        update((s) => ({ ...s, mode: 'custom' }));
        openMotion();
      }}
      setDepart={(d) => update((s) => ({ ...s, motion: { ...s.motion, depart: d }, mode: recipeOf({ ...s.motion, depart: d }, s.mode) }))}
      status={status}
      canPlay={Boolean(player) && doc.target !== undefined && state.status !== 'idle'}
      onPlay={playFrom}
      onStop={stop}
      onFullscreen={fullscreen}
      compact={compact}
    />
  );
  const exportReady = Boolean(builder) && doc.target !== undefined;
  const deliver = (placement: 'panel' | 'drawer') => <MosaicDeliver settings={doc.settings} stageW={stageW} stageH={stageH} exporter={exporter} ready={exportReady} placement={placement} />;
  const settings = (only: SettingsTab, docked = false) => (
    <MosaicSettings
      only={only}
      docked={docked}
      settings={doc.settings}
      update={update}
      view={view}
      setView={setView}
      state={state}
      perf={perf}
      setPerf={setPerf}
      workers={workers}
      fps={fps}
      chain={status.prepMs !== null ? { prepMs: status.prepMs, waits: status.waits, waitMs: status.waitMs, done: status.done } : null}
      cropped={Boolean(doc.crop) && !status.playing}
      onWhole={() => setCrop(undefined)}
      onChoose={() => setChoosing({ for: 'target' })}
      exporting={<MosaicExportPanel settings={doc.settings} update={update} />}
      target={
        <TargetFrame
          bitmap={onScreen ? onScreen.bitmap : targetBitmap}
          fallbackUrl={client && cardId !== undefined ? client.thumbUrl(cardId) : null}
          showing={onScreen?.id ?? null}
          aspect={aspect}
          crop={doc.crop}
          onCrop={setCrop}
          onChoose={() => setChoosing({ for: 'target' })}
          frozen={status.playing}
        />
      }
    />
  );
  const chooser =
    choosing && client ? (
      <TargetChooser
        tiles={measured}
        client={client}
        current={choosing.for === 'replace' ? chain.queue[choosing.at]?.id : doc.target}
        title={choosing.for === 'target' ? 'Choose the target' : choosing.for === 'replace' ? `Picture ${choosing.at + 1} of the chain` : 'Add a picture to the chain'}
        onClose={() => setChoosing(null)}
        onChoose={(id) => {
          const what = choosing;
          setChoosing(null);
          if (what.for === 'target') setTarget(id);
          else if (what.for === 'replace') change((d) => queueSet(d, what.at, id));
          else change((d) => queueInsert(d, chainOf(d).queue.length, id));
        }}
      />
    ) : null;

  if (compact) {
    const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;
    return (
      <>
        {header([
          { id: 'choose', label: 'Choose the target…', onSelect: () => setChoosing({ for: 'target' }) },
          ...(canFullscreen ? [{ id: 'screen', label: 'Full screen', onSelect: fullscreen }] : []),
        ])}
        {/* No floor on the stage's height (Develop's rule): the drawer takes its share, and the stage shows smaller. */}
        <div ref={boxRef} className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center rounded-control bg-frame overflow-hidden [&:fullscreen]:bg-frame">
          {stage}
        </div>
        {band}
        {transport}
        <PanelHost asSheet compactAs="drawer" open={tabOpen} onClose={() => setTabOpen(false)} title={SETTINGS_TABS.find((t) => t.id === tab)?.title ?? 'Settings'}>
          <div className="px-1 pb-4 overflow-x-hidden">{settings(tab)}</div>
          {(tab === 'export' || exporter.running !== null) && deliver('drawer')}
        </PanelHost>
        {chooser}
      </>
    );
  }

  // Side by side from 860 px of room; under it, ONE column that scrolls as a whole — the stage a height of its own, the
  // band, the transport, then the settings — never a stage column squeezed under an inspector that overlaps it.
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-hidden @min-[860px]:overflow-visible @min-[860px]:grid @min-[860px]:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex-none min-w-0 flex flex-col gap-3 @min-[860px]:min-h-0">
        <div
          ref={boxRef}
          className="flex-none h-[calc(var(--app-h,100dvh)*0.55)] min-h-[200px] min-w-0 flex items-start justify-center @min-[860px]:h-auto @min-[860px]:flex-1 [&:fullscreen]:items-center [&:fullscreen]:bg-frame"
        >
          {stage}
        </div>
        {band}
        {transport}
      </div>
      {/* The inspector as a block (`InspectorBlock`, lab 13 — Mosaic's since his word of 2026-11-10): the phone's five
          parts as tabs pinned on one row, a part's sections under them, the two export verbs at its foot — on the
          Export tab, and on every tab while a file is being written. */}
      <InspectorBlock
        label="Mosaic settings"
        bodyClassName="gap-3"
        head={<Segmented<SettingsTab> size="sm" fill label="Settings" value={tab} onChange={setTab} options={SETTINGS_TABS.map((t) => ({ id: t.id, label: t.title }))} className={BLOCK_TABS} />}
        foot={tab === 'export' || exporter.running !== null ? deliver('panel') : undefined}
      >
        {settings(tab, true)}
      </InspectorBlock>
      {chooser}
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
export default function MosaicEditor({ doc, change, saveState, onBack, band, headerExtra, syncPill }: MosaicEditorProps) {
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
  // Every write of this screen through the shell's funnel, the ref written the moment it applies — a measuring run
  // started right after an add, or an agent's next command, reads the mosaic as it is, not as it last rendered.
  const act = useCallback(
    (fn: (d: MosaicDoc) => MosaicDoc) =>
      change((d) => {
        const next = fn(d);
        docRef.current = next;
        return next;
      }),
    [change],
  );

  const runOnce = useCallback(
    async (retryFailed: boolean) => {
      const cur = docRef.current;
      if (running.current || !client || !connection || !cur.instance || cur.instance !== connection.id) return;
      const todo = unmeasured(cur, retryFailed);
      if (!todo.length) return;
      const controller = new AbortController();
      running.current = controller;
      setNotice(null);
      try {
        const perf = MOSAIC_PERF_PREF.get();
        const workers = perf.measure === 'main' ? 0 : perf.measure === 'one' ? 1 : workersHere(perf);
        const result = await runMeasure(client, cur.instance, todo, { signal: controller.signal, onProgress: setProgress, workers });
        act((d) => withMeasures(d, result.grids, result.failed));
        if (result.failed.length) setNotice(`${result.failed.length} picture${result.failed.length === 1 ? '' : 's'} could not be read from ${connection.id} — skipped; Measure again tries them once more.`);
        else if (result.cancelled) setNotice('Measuring stopped; what was measured is kept.');
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        running.current = null;
        setProgress(null);
      }
    },
    [client, connection, act],
  );
  // One run at a time, its list fixed when it starts: a call while one runs queues ANOTHER after it, which takes what
  // the first could not see (pictures added meanwhile, a retry asked) and finds nothing to do when there is nothing.
  // What it answers ends when every run asked so far has — what an agent's `wait` waits for.
  const runPromise = useRef<Promise<void> | null>(null);
  const measure = useCallback(
    (retryFailed: boolean): Promise<void> => {
      const start = () => runOnce(retryFailed);
      const run = (runPromise.current ? runPromise.current.then(start) : start()).finally(() => {
        if (runPromise.current === run) runPromise.current = null;
      });
      runPromise.current = run;
      return run;
    },
    [runOnce],
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
      act((d) => withPictures(d, tiles, instance, span));
      // The document above is applied synchronously and written to the ref; the run reads it from there.
      queueMicrotask(() => void measure(false));
    },
    [act, measure],
  );

  // --- the target: the picture rebuilt; the first measured one until a click or a draw says otherwise ---
  const measuredCount = doc.tiles.filter((t) => t.grid).length;
  const salt = useRef(0);
  useEffect(() => {
    if (doc.target !== undefined || !measuredCount) return;
    const id = randomTarget(doc, salt.current++);
    if (id !== undefined) change((d) => withTarget(d, id));
  }, [doc, measuredCount, change]);
  // A new target drops the crop: a crop belongs to its picture.
  const setTarget = useCallback((id: number) => act((d) => withTarget(d, id)), [act]);
  const setCrop = useCallback((crop: Crop | undefined) => act((d) => withCrop(d, crop)), [act]);

  const update = useCallback((fn: (s: Settings) => Settings) => act((d) => ({ ...d, settings: sanitizeSettings(fn(d.settings)), updatedAt: Date.now() })), [act]);
  // Previous and next over the targets visited, as a browser's back and forward.
  const steps = useTargetSteps(doc, change);

  const failed = doc.tiles.filter((t) => t.failed).length;
  const pending = unmeasured(doc, false).length;
  const canMeasure = Boolean(client && connection && doc.instance === connection.id) && !progress;
  const drawTarget = () => {
    const id = randomTarget(docRef.current, salt.current++);
    if (id !== undefined) setTarget(id);
    return id;
  };
  useMosaicEditorCommands({
    latest: docRef,
    // The params refuse what is out of bounds; the settings still pass the stored reader's bounds, as a dial's do.
    change: (fn) =>
      act((d) => {
        const next = fn(d);
        return next.settings === d.settings ? next : { ...next, settings: sanitizeSettings(next.settings) };
      }),
    connection,
    client,
    add: onAdd,
    measure,
    measuring: () => Boolean(running.current),
    setTarget,
    drawTarget,
  });
  const countLine = progress
    ? `measuring ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}…`
    : `${pictureCountLine(doc)}${failed ? ` · ${failed} skipped` : ''}`;
  const titleField = (
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
      className={`min-w-0 flex-1 px-2 rounded-control border border-transparent bg-transparent font-serif text-ink hover:border-line focus:border-line-strong focus:bg-paper focus:outline-none ${compact ? 'w-full h-6 text-base leading-tight' : 'h-9 text-2xl'}`}
    />
  );

  // --- a phone: the editor's own header line (back · title over the count · targets · history · ⋯), the masthead gone,
  // the settings in the shell's floating bottom bar, each tab a drawer under the stage — Storytelling's and Develop's.
  usePublishShellChrome(useMemo(() => (compact ? { immersive: true, floating: false, hidden: false, backdrop: 'frame' as const } : null), [compact]));
  const [pickerOpen, setPickerOpen] = useState(false);
  const otherInstance = Boolean(connection && doc.instance && doc.instance !== connection.id);
  const phoneMenu: OverflowItem[] = [
    ...(measuredCount > 1 ? [{ id: 'draw', label: 'Draw a target', onSelect: drawTarget }] : []),
    connection && client
      ? {
          id: 'add',
          label: otherInstance ? `Pictures from ${doc.instance}` : `Add from ${connection.id}…`,
          disabled: otherInstance,
          onSelect: () => setPickerOpen(true),
          rule: measuredCount > 1,
        }
      : { id: 'connect', label: 'Connect a Winnow', onSelect: () => navigate('/sources'), rule: measuredCount > 1 },
    ...(!progress && (pending > 0 || failed > 0)
      ? [{ id: 'measure', label: pending ? `Measure ${pending.toLocaleString()}` : 'Measure again', disabled: !canMeasure, onSelect: () => void measure(pending === 0) }]
      : []),
  ];
  const phoneHeader = (extra: OverflowItem[]) => (
    <>
      <PhoneHeader
        floating={false}
        back={{ label: 'Back to the mosaics', onClick: onBack }}
        title={titleField}
        subtitle={
          <span className={`block px-2 font-mono text-3xs tabular-nums truncate ${saveState === 'failed' ? 'text-danger' : 'text-muted'}`} role="status">
            {saveState === 'failed' ? `${SAVE_WORDS.failed} · ` : ''}
            {countLine}
          </span>
        }
        trailing={
          <>
            {doc.tiles.length > 0 && <TargetStepsControl steps={steps} />}
            {syncPill}
            {headerExtra}
          </>
        }
        menu={[...extra, ...phoneMenu.map((it, i) => (i === 0 && extra.length ? { ...it, rule: true } : it))]}
      />
      {band}
      {notice && (
        <p className="m-0 px-1 text-xs text-ink-soft" role="status">
          {notice}
        </p>
      )}
    </>
  );

  if (compact) {
    return (
      <section className="@container flex-1 min-h-0 min-w-0 flex flex-col gap-2 pb-2" aria-label="Mosaic">
        {doc.tiles.length === 0 ? (
          <>
            {phoneHeader([])}
            <EmptyState
              title="No pictures yet"
              actions={
                connection && client ? (
                  <Button variant="primary" icon={Icons.plus} onClick={() => setPickerOpen(true)}>
                    Add from {connection.id}
                  </Button>
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
          </>
        ) : (
          <MosaicWorkbench doc={doc} client={client} change={act} update={update} setTarget={setTarget} setCrop={setCrop} steps={steps} compact header={phoneHeader} latest={docRef} />
        )}
        {/* At one place in the tree, outside the branches: an add swaps the empty state for the workbench, and a picker
            drawn inside either would be mounted again, still open. */}
        {connection && client && (
          <MosaicPicker
            doc={doc}
            connection={connection}
            client={client}
            onAdd={(tiles, instance, span) => {
              setPickerOpen(false);
              onAdd(tiles, instance, span);
            }}
            trigger={false}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          />
        )}
      </section>
    );
  }

  return (
    <section className="@container flex-1 min-h-0 flex flex-col gap-3" aria-label="Mosaic">
      <PageBar
        back={{ label: 'Mosaics', onClick: onBack, iconOnly: compact }}
        trailing={
          <span className="inline-flex items-center gap-2">
            {doc.tiles.length > 0 && <TargetStepsControl steps={steps} />}
            {syncPill}
            {headerExtra}
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
          </span>
        }
      >
        {titleField}
      </PageBar>
      {band}
      <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-control bg-surface shadow-paper-soft">
        <span className="font-mono text-2xs text-muted tabular-nums" role="status">
          {countLine}
        </span>
        <span className="flex-1" />
        {measuredCount > 1 && (
          <Button
            size="sm"
            variant="ghost"
            icon={Icons.swap}
            onClick={drawTarget}
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
        <MosaicWorkbench doc={doc} client={client} change={act} update={update} setTarget={setTarget} setCrop={setCrop} steps={steps} compact={false} header={() => null} latest={docRef} />
      )}
    </section>
  );
}
