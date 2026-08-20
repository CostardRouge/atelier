import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import type { Asset } from '../../shared/library/assets';
import { formatDuration } from '../../shared/lib/format';
import { parseSrt, type Cue } from '../../shared/telemetry/srt-parser';
import { useActiveCue } from '../../shared/telemetry/use-active-cue';
import { extractTrack, parsePosition } from '../../shared/telemetry/flight-path';
import { DEFAULT_OVERLAY, OVERLAY_FIELDS, type OverlayConfig, type OverlayFont } from './overlay';
import { drawReadout, type Box } from './draw-readout';
import { makeFrameGrader, type FrameGrader } from '../../shared/lut/frame-grader';
import { useLutSelection } from '../../shared/lut/use-lut-selection';
import LutPicker from '../../shared/lut/LutPicker';
import {
  fitRect,
  outputSize,
  paneRects,
  type Corner,
  type Fit,
  type LayoutKind,
} from './compose-layout';
import { useComposerMap } from './use-composer-map';
import {
  compositionName,
  downloadBlob,
  exportComposition,
  type CompositionOptions,
} from './export-composition';
import {
  DecodeUnsupportedError,
  isExportSupported,
  type ExportProgress,
} from '../../shared/media/webcodecs-export';

const COMPOSER_KINDS = ['video+telemetry'] as const;
const PREVIEW_MAX = 1440;
const GRADE_MAX = 1280;

const ASPECTS = [
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
  { id: '1:1', w: 1, h: 1 },
  { id: '4:5', w: 4, h: 5 },
];
const QUALITIES = [
  { id: 'HD', long: 1280 },
  { id: 'Full HD', long: 1920 },
];
const LAYOUTS: Array<{ id: LayoutKind; label: string }> = [
  { id: 'side-by-side', label: 'Side by side' },
  { id: 'stacked', label: 'Stacked' },
  { id: 'pip-map', label: 'Map inset' },
  { id: 'pip-video', label: 'Video inset' },
];
const CORNERS: Array<{ id: Corner; label: string }> = [
  { id: 'tl', label: '↖' },
  { id: 'tr', label: '↗' },
  { id: 'bl', label: '↙' },
  { id: 'br', label: '↘' },
];

interface Active {
  id: string;
  baseName: string;
  video: File;
  srt: File;
}

function resolveActive(assets: readonly Asset[], id: string | null): Active | null {
  if (!id) return null;
  const a = assets.find((x) => x.id === id);
  if (!a || !a.parts.video || !a.parts.srt) return null;
  return { id, baseName: a.baseName, video: a.parts.video, srt: a.parts.srt };
}

export default function ComposerTool() {
  const lib = useAssetLibrary();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // --- output / layout settings -------------------------------------------
  const [aspectId, setAspectId] = useState('9:16');
  const [quality, setQuality] = useState(1920);
  const [layout, setLayout] = useState<LayoutKind>('stacked');
  const [split, setSplit] = useState(0.6);
  const [inset, setInset] = useState(0.3);
  const [corner, setCorner] = useState<Corner>('br');
  const [videoFit, setVideoFit] = useState<Fit>('cover');
  const [tilesOn, setTilesOn] = useState(true);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [follow, setFollow] = useState(true);
  const [overlay, setOverlay] = useState<OverlayConfig>(DEFAULT_OVERLAY);
  const [readoutPos, setReadoutPos] = useState({ x: 0.04, y: 0.8 });

  const aspect = ASPECTS.find((a) => a.id === aspectId) ?? ASPECTS[0];
  const out = useMemo(() => outputSize(aspect.w, aspect.h, quality), [aspect, quality]);
  const previewScale = Math.min(1, PREVIEW_MAX / Math.max(out.w, out.h));
  const pw = Math.round(out.w * previewScale);
  const ph = Math.round(out.h * previewScale);
  const panes = useMemo(
    () => paneRects(pw, ph, layout, split, inset, corner),
    [pw, ph, layout, split, inset, corner],
  );

  // --- LUT ----------------------------------------------------------------
  const lutSel = useLutSelection();
  const { lut, intensity } = lutSel;

  // --- active clip + telemetry --------------------------------------------
  const clips = useMemo(
    () =>
      selectedUsableAssets(COMPOSER_KINDS, lib.assets, lib.selection).map((a) => ({
        id: a.id,
        baseName: a.baseName,
      })),
    [lib.assets, lib.selection],
  );
  const activeId =
    lib.activeId && clips.some((c) => c.id === lib.activeId)
      ? lib.activeId
      : (clips[0]?.id ?? null);
  const active = resolveActive(lib.assets, activeId);

  useEffect(() => {
    if (activeId && activeId !== lib.activeId) lib.setActive(activeId);
  }, [activeId, lib.activeId, lib.setActive]);

  const [cues, setCues] = useState<Cue[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportRatio, setExportRatio] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const exportSupported = isExportSupported();

  useEffect(() => {
    const srt = active?.srt;
    if (!srt) {
      setCues([]);
      return;
    }
    let cancelled = false;
    srt
      .text()
      .then((t) => !cancelled && setCues(parseSrt(t)))
      .catch(() => !cancelled && setCues([]));
    return () => {
      cancelled = true;
    };
  }, [active?.srt]);

  useEffect(() => {
    const video = active?.video;
    if (!video) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(video);
    setUrl(objectUrl);
    setVideoDims(null);
    return () => URL.revokeObjectURL(objectUrl);
  }, [active?.video]);

  const track = useMemo(() => extractTrack(cues), [cues]);
  const activeCue = useActiveCue(videoRef, cues, url);
  const position = useMemo<[number, number] | null>(() => {
    const live = activeCue ? parsePosition(activeCue) : null;
    if (live) return live;
    return track.length ? [track[0].lon, track[0].lat] : null;
  }, [activeCue, track]);

  const map = useComposerMap(mapContainerRef, track, tilesOn, zoomOffset, follow, position);
  const { getCanvas, resize } = map;

  // --- frame grader (LUT) -------------------------------------------------
  const graderRef = useRef<FrameGrader | null>(null);
  const graderDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    graderRef.current?.dispose();
    graderRef.current = null;
    if (!lut || !videoDims) return;
    const gw = Math.min(videoDims.w, GRADE_MAX);
    const gh = Math.round((gw * videoDims.h) / videoDims.w);
    graderRef.current = makeFrameGrader(lut, gw, gh, intensity);
    graderDimsRef.current = { w: gw, h: gh };
    return () => {
      graderRef.current?.dispose();
      graderRef.current = null;
    };
  }, [lut, intensity, videoDims?.w, videoDims?.h]);

  // --- live values for the draw loop (refs to avoid stale closures) --------
  const cueRef = useRef<Cue | null>(null);
  cueRef.current = activeCue;
  const readoutRef = useRef(readoutPos);
  readoutRef.current = readoutPos;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const readoutBoxRef = useRef<Box | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const rects = paneRects(w, h, layout, split, inset, corner);

    const drawVideoPane = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      let src: CanvasImageSource = v;
      let sw = v.videoWidth;
      let sh = v.videoHeight;
      if (lut && graderRef.current) {
        src = graderRef.current.render(v);
        sw = graderDimsRef.current.w;
        sh = graderDimsRef.current.h;
      }
      const f = fitRect(sw, sh, rects.video, videoFit);
      ctx.drawImage(src, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
    };

    // The map's WebGL canvas is sized to its pane, but draw via fitRect (cover)
    // so it's never stretched even during a resize — aspect is always preserved.
    const drawMapPane = () => {
      const mc = getCanvas();
      if (!mc || !mc.width || !mc.height) return;
      const f = fitRect(mc.width, mc.height, rects.map, 'cover');
      ctx.drawImage(mc, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
    };

    // Draw the full-frame pane first, the inset pane on top.
    if (layout === 'pip-video') {
      drawMapPane();
      drawVideoPane();
    } else {
      drawVideoPane();
      drawMapPane();
    }

    readoutBoxRef.current = drawReadout(
      ctx,
      cueRef.current,
      readoutRef.current,
      w,
      h,
      overlayRef.current,
    );
  }, [layout, split, inset, corner, videoFit, lut, getCanvas]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Continuous compositing loop while a clip is active (keeps the map fresh too).
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      drawRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active?.id]);

  // Transport state from the offscreen video element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => {
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      setVideoDims({ w: v.videoWidth, h: v.videoHeight });
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [url]);

  // The offscreen map container is sized to its pane via JSX (below); when that
  // changes, tell MapLibre to re-read the size and re-frame the track.
  useEffect(() => {
    resize();
  }, [panes.map.w, panes.map.h, resize]);

  // --- transport + drag ---------------------------------------------------
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  async function handleExport() {
    if (!active || exporting) return;
    videoRef.current?.pause();
    setExportError(null);
    setExporting(true);
    setExportRatio(null);
    const controller = new AbortController();
    exportAbort.current = controller;
    const cfg: CompositionOptions = {
      outW: out.w,
      outH: out.h,
      layout,
      split,
      inset,
      corner,
      videoFit,
      lut,
      intensity,
      overlay,
      readoutPos,
      cues,
      track,
      tilesOn,
      zoomOffset,
      previewScale,
    };
    try {
      const blob = await exportComposition(
        active.video,
        cfg,
        (p: ExportProgress) => setExportRatio(p.phase === 'encoding' ? p.ratio : null),
        controller.signal,
      );
      downloadBlob(blob, compositionName(active.video.name));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        /* cancelled — no message */
      } else if (
        err instanceof DOMException &&
        (err.name === 'NotReadableError' || err.name === 'NotFoundError')
      ) {
        setExportError(
          'Couldn’t read the video file. Clips opened from a folder can become unreadable after a while — re-add this clip to the Library (drag it in, or use “Add files”) and export again.',
        );
      } else if (err instanceof DecodeUnsupportedError) {
        setExportError(
          err.isHevc
            ? "This browser can't decode HEVC/H.265 for export. Try Safari, or transcode the clip to H.264 first."
            : "This browser can't decode this clip's codec for export.",
        );
      } else {
        setExportError(err instanceof Error ? err.message : 'Export failed.');
      }
    } finally {
      setExporting(false);
      setExportRatio(null);
      exportAbort.current = null;
    }
  }

  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  function toPreview(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }
  function onPointerDown(e: React.PointerEvent) {
    const p = toPreview(e);
    const box = readoutBoxRef.current;
    if (box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
      dragRef.current = { dx: p.x - box.x, dy: p.y - box.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const p = toPreview(e);
    const c = canvasRef.current!;
    const next = {
      x: Math.min(1, Math.max(0, (p.x - dragRef.current.dx) / c.width)),
      y: Math.min(1, Math.max(0, (p.y - dragRef.current.dy) / c.height)),
    };
    readoutRef.current = next;
    setReadoutPos(next);
    drawRef.current();
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  // --- UI -----------------------------------------------------------------
  const activeIndex = clips.findIndex((c) => c.id === activeId);
  const isPip = layout === 'pip-map' || layout === 'pip-video';

  const chip =
    'inline-flex items-center h-[1.9rem] px-[0.7rem] rounded-full border text-[0.74rem] font-semibold transition-colors aria-pressed:border-accent aria-pressed:text-accent-ink aria-pressed:bg-accent-wash border-line-strong bg-paper text-ink-soft hover:border-faint hover:text-ink';

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-[0.6rem] overflow-y-auto max-[820px]:overflow-visible" aria-label="Composer">
      {/* Clip + output settings. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        {clips.length === 0 ? (
          <span className="text-[0.82rem] text-muted px-1">
            Select a DJI clip (video + <code className="font-mono">.srt</code>) in
            the Library to compose.
          </span>
        ) : (
          <>
            {clips.length > 1 && (
              <div className="flex items-center gap-1 flex-none">
                <button
                  type="button"
                  className="w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft hover:border-accent hover:text-accent-ink disabled:opacity-40"
                  onClick={() => activeIndex > 0 && lib.setActive(clips[activeIndex - 1].id)}
                  disabled={activeIndex <= 0}
                  aria-label="Previous clip"
                >
                  ‹
                </button>
                <span className="font-mono text-[0.7rem] text-muted tabular-nums">
                  {activeIndex + 1}/{clips.length}
                </span>
                <button
                  type="button"
                  className="w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft hover:border-accent hover:text-accent-ink disabled:opacity-40"
                  onClick={() => activeIndex < clips.length - 1 && lib.setActive(clips[activeIndex + 1].id)}
                  disabled={activeIndex >= clips.length - 1}
                  aria-label="Next clip"
                >
                  ›
                </button>
              </div>
            )}
            <span className="font-semibold text-[0.88rem] truncate max-w-[14rem]" title={active?.baseName}>
              {active?.baseName}
            </span>
            <span className="font-mono text-[0.66rem] text-muted">
              {out.w}×{out.h}
            </span>
          </>
        )}
      </div>

      {active && (
        <>
          {/* Controls. */}
          <div className="flex flex-col gap-2 px-2 py-2 border border-line rounded-paper-lg bg-surface shadow-paper-soft text-[0.74rem]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted w-14">Aspect</span>
              {ASPECTS.map((a) => (
                <button key={a.id} type="button" className={chip} aria-pressed={aspectId === a.id} onClick={() => setAspectId(a.id)}>
                  {a.id}
                </button>
              ))}
              <span className="w-3" />
              {QUALITIES.map((q) => (
                <button key={q.id} type="button" className={chip} aria-pressed={quality === q.long} onClick={() => setQuality(q.long)}>
                  {q.id}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted w-14">Layout</span>
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" className={chip} aria-pressed={layout === l.id} onClick={() => setLayout(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {!isPip ? (
                <label className="flex items-center gap-2">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Split</span>
                  <input type="range" min={0.2} max={0.8} step={0.01} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="accent-accent w-32" />
                </label>
              ) : (
                <>
                  <label className="flex items-center gap-2">
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Inset</span>
                    <input type="range" min={0.15} max={0.5} step={0.01} value={inset} onChange={(e) => setInset(Number(e.target.value))} className="accent-accent w-28" />
                  </label>
                  <div className="flex items-center gap-1">
                    {CORNERS.map((c) => (
                      <button key={c.id} type="button" className={`${chip} w-8 justify-center px-0`} aria-pressed={corner === c.id} onClick={() => setCorner(c.id)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="flex items-center gap-1">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Video</span>
                {(['cover', 'contain'] as const).map((m) => (
                  <button key={m} type="button" className={chip} aria-pressed={videoFit === m} onClick={() => setVideoFit(m)}>
                    {m}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Map zoom</span>
                <input type="range" min={-4} max={4} step={0.5} value={zoomOffset} onChange={(e) => setZoomOffset(Number(e.target.value))} className="accent-accent w-28" />
              </label>
              <button type="button" className={chip} aria-pressed={tilesOn} onClick={() => setTilesOn((t) => !t)} title="Load OpenStreetMap tiles — the one feature that makes a network request">
                {tilesOn ? 'Map: tiles' : 'Map: offline'}
              </button>
              <button type="button" className={chip} aria-pressed={follow} onClick={() => setFollow((f) => !f)} title="Keep the map centred on the aircraft as the clip plays">
                {follow ? 'Follow: on' : 'Follow: off'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <LutPicker
                selected={lutSel.selected}
                customName={lutSel.customName}
                busy={lutSel.busy}
                intensity={lutSel.intensity}
                onIntensityChange={lutSel.setIntensity}
                onSelect={lutSel.applySelection}
                onUpload={lutSel.uploadCube}
              />
            </div>

            {/* Overlay (telemetry readout) options. */}
            <div className="flex flex-col gap-2 border-t border-line pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted w-14">Overlay</span>
                <button type="button" className={chip} aria-pressed={overlay.show} onClick={() => setOverlay((o) => ({ ...o, show: !o.show }))}>
                  {overlay.show ? 'shown' : 'hidden'}
                </button>
                <button type="button" className={chip} aria-pressed={overlay.labels} onClick={() => setOverlay((o) => ({ ...o, labels: !o.labels }))} title="Show the field label prefixes">
                  labels
                </button>
                <span className="w-2" />
                {OVERLAY_FIELDS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={chip}
                    aria-pressed={!!overlay.fields[f.id]}
                    onClick={() => setOverlay((o) => ({ ...o, fields: { ...o.fields, [f.id]: !o.fields[f.id] } }))}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-1.5">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Text</span>
                  <input type="color" value={overlay.textColor} onChange={(e) => setOverlay((o) => ({ ...o, textColor: e.target.value }))} className="w-7 h-7 rounded border border-line-strong bg-paper cursor-pointer" aria-label="Text colour" />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Bg</span>
                  <input type="color" value={overlay.bgColor} onChange={(e) => setOverlay((o) => ({ ...o, bgColor: e.target.value }))} className="w-7 h-7 rounded border border-line-strong bg-paper cursor-pointer" aria-label="Background colour" />
                  <input type="range" min={0} max={1} step={0.05} value={overlay.bgOpacity} onChange={(e) => setOverlay((o) => ({ ...o, bgOpacity: Number(e.target.value) }))} className="accent-accent w-20" aria-label="Background opacity" />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Radius</span>
                  <input type="range" min={0} max={32} step={1} value={overlay.radius} onChange={(e) => setOverlay((o) => ({ ...o, radius: Number(e.target.value) }))} className="accent-accent w-20" />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Size</span>
                  <input type="range" min={0.6} max={2.2} step={0.1} value={overlay.fontScale} onChange={(e) => setOverlay((o) => ({ ...o, fontScale: Number(e.target.value) }))} className="accent-accent w-20" />
                </label>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">Font</span>
                  {(['mono', 'sans', 'serif'] as OverlayFont[]).map((fnt) => (
                    <button key={fnt} type="button" className={chip} aria-pressed={overlay.font === fnt} onClick={() => setOverlay((o) => ({ ...o, font: fnt }))}>
                      {fnt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Composite preview. */}
          <div className="flex-none grid place-items-center bg-frame rounded-paper overflow-hidden border border-line p-2 max-h-[52vh]">
            <canvas
              ref={canvasRef}
              width={pw}
              height={ph}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="block max-w-full max-h-[48vh] object-contain touch-none cursor-grab"
              title="Drag the telemetry readout to reposition it"
            />
          </div>

          {map.error && (
            <p className="flex-none m-0 px-4 py-2 rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.82rem]">
              The map library couldn't load — the composition will show the video
              and telemetry only.
            </p>
          )}

          {/* Transport + export. */}
          <div className="flex-none flex items-center gap-[0.85rem] px-[0.85rem] py-[0.6rem] border border-line rounded-paper bg-surface">
            <button
              type="button"
              className="flex-none w-[2.2rem] h-[2.2rem] border-0 rounded-full bg-ink text-paper text-[0.8rem] leading-none inline-flex items-center justify-center hover:bg-accent transition-colors"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <input
              type="range"
              className="flex-1 accent-accent cursor-pointer"
              min={0}
              max={duration || 0}
              step={0.001}
              value={Math.min(time, duration || 0)}
              onChange={(e) => {
                const v = videoRef.current;
                if (v) v.currentTime = Number(e.target.value);
                setTime(Number(e.target.value));
              }}
              aria-label="Seek"
            />
            <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none">
              {formatDuration(duration)}
            </span>
            {exporting ? (
              <>
                <span className="font-mono text-[0.72rem] text-ink-soft flex-none tabular-nums min-w-[7ch] text-right">
                  {exportRatio != null ? `${Math.round(exportRatio * 100)}%` : 'Rendering…'}
                </span>
                <button
                  type="button"
                  className="flex-none p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] hover:text-accent"
                  onClick={() => exportAbort.current?.abort()}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!exportSupported}
                className="flex-none px-[1.1rem] py-2 rounded-full border border-ink bg-ink text-paper text-[0.82rem] font-semibold cursor-pointer transition-colors hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-default"
                onClick={handleExport}
                title={
                  exportSupported
                    ? 'Render the composition to an MP4'
                    : 'Export needs WebCodecs — try Chrome or Edge'
                }
              >
                Export MP4
              </button>
            )}
          </div>

          {exportError && (
            <p className="flex-none m-0 px-4 py-2 rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.82rem]">
              {exportError}
            </p>
          )}
          {!exportSupported && !exportError && (
            <p className="flex-none m-0 text-[0.76rem] text-muted px-1">
              MP4 export needs WebCodecs (Chrome/Edge); the live preview works
              everywhere.
            </p>
          )}
        </>
      )}

      {/* Offscreen decoder video + offscreen map (read into the composite). */}
      <video
        ref={videoRef}
        src={url ?? undefined}
        className="absolute w-px h-px left-0 bottom-0 opacity-0 pointer-events-none"
        playsInline
      />
      <div
        ref={mapContainerRef}
        aria-hidden="true"
        className="fixed left-[-99999px] top-0 pointer-events-none"
        style={{ width: Math.max(1, panes.map.w), height: Math.max(1, panes.map.h) }}
      />
    </section>
  );
}
