import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCube, type CubeLut } from '../../shared/lib/cube-parser';
import { formatDuration } from '../../shared/lib/format';
import { BUILTIN_LUTS, LUT_GROUPS, UNGROUPED_LUTS } from './builtin-luts';
import { isExportSupported } from './export-video';
import { runBatchExport } from './batch-export';
import { type Clip } from './clip';
import {
  loadClipMeta,
  probeContainer,
  type ContainerInfo,
} from '../../shared/media/video-metadata';
import { useLutPreview } from './use-lut-preview';
import { CUBE_ACCEPT, pickFile } from '../../shared/sources/file-sources';
import ClipList from './ClipList';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';

/** Precise current-position readout: `M:SS.cs` (centiseconds). */
function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Max number of clip thumbnails/metadata to read at once. */
const META_CONCURRENCY = 3;

/**
 * LUT Studio — a collection of videos, graded through a `.cube` LUT.
 *
 * Left column: the clip list (thumbnail + summary + export checkbox). Right
 * pane: the real-time WebGL preview of the *active* clip with the look picker.
 * Bottom bar: batch-export the checked clips (sequential, one encoder at a
 * time). Only the active clip is ever decoded for preview; nothing uploads.
 */
export default function LutStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  // True while dragging the scrubber, so `timeupdate` doesn't fight the drag.
  const scrubbingRef = useRef(false);
  // Last before/after wipe position (0..1), kept in a ref so pointer moves
  // reposition the divider without re-rendering.
  const splitXRef = useRef(0.5);

  const lib = useAssetLibrary();

  const [clips, setClips] = useState<Clip[]>([]);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [activeError, setActiveError] = useState(false);
  const [activeInfo, setActiveInfo] = useState<ContainerInfo>({});

  const [lut, setLut] = useState<CubeLut | null>(null);
  const [selected, setSelected] = useState('none'); // 'none' | builtin id | 'custom'
  const [customLut, setCustomLut] = useState<CubeLut | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [cubeError, setCubeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bypass, setBypass] = useState(false);
  // Before/after wipe: a divider that follows the cursor over the preview,
  // grade on the left, original on the right (like Lightroom / Capture One).
  const [compareOn, setCompareOn] = useState(false);

  // Transport state, mirrored from the offscreen video element.
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Batch export state.
  const [exporting, setExporting] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const exportAbort = useRef<AbortController | null>(null);
  const exportSupported = isExportSupported();

  const metaProcessing = useRef<Set<string>>(new Set());

  const { supported, setSplit } = useLutPreview(
    videoRef,
    canvasRef,
    lut,
    bypass,
    activeUrl,
  );

  const activeClip = clips.find((c) => c.id === activeId) ?? null;

  // --- clip helpers -------------------------------------------------------

  function updateClip(id: string, fn: (c: Clip) => Clip) {
    setClips((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }

  // The video files selected in the shared library, in library order. A clip's
  // id is its asset id, so removing a clip just deselects its asset.
  const selectedVideos = useMemo(
    () =>
      selectedUsableAssets(['video'], lib.assets, lib.selection)
        .map((a) => ({ assetId: a.id, file: a.parts.video }))
        .filter((v): v is { assetId: string; file: File } => Boolean(v.file)),
    [lib.assets, lib.selection],
  );

  // Reconcile the clip list to the selection: keep existing clips (with their
  // metadata, thumbnail and export state), add newly-selected ones, drop
  // deselected ones (revoking their thumbnails). All heavy state lives here, in
  // the tool — the library holds only handles.
  useEffect(() => {
    setClips((prev) => {
      const want = new Map(selectedVideos.map((v) => [v.assetId, v.file]));
      for (const c of prev) {
        if (!want.has(c.id) && c.thumbUrl) URL.revokeObjectURL(c.thumbUrl);
      }
      const byId = new Map(
        prev.filter((c) => want.has(c.id)).map((c) => [c.id, c] as const),
      );
      for (const [assetId, file] of want) {
        if (byId.has(assetId)) continue;
        byId.set(assetId, {
          id: assetId,
          file,
          name: file.name,
          size: file.size,
          metaStatus: 'pending',
          exportSelected: true,
          exportStatus: 'idle',
          exportRatio: null,
        });
      }
      const next = selectedVideos.map((v) => byId.get(v.assetId)!);
      const same =
        next.length === prev.length && next.every((c, i) => c === prev[i]);
      return same ? prev : next;
    });
  }, [selectedVideos]);

  // Removing a clip from the list deselects its asset in the library (the
  // reconcile effect above then drops it and revokes its thumbnail).
  function removeClip(id: string) {
    lib.toggle(id);
  }

  function toggleAll(checked: boolean) {
    setClips((prev) => prev.map((c) => ({ ...c, exportSelected: checked })));
  }

  // --- effects ------------------------------------------------------------

  // Keep a valid active clip: default to the first, and repoint if the active
  // one was removed (deselected) from the list.
  useEffect(() => {
    if (clips.length === 0) {
      if (activeId !== null) setActiveId(null);
    } else if (activeId === null || !clips.some((c) => c.id === activeId)) {
      setActiveId(clips[0].id);
    }
  }, [clips, activeId]);

  // Lazily read metadata + thumbnails for pending clips, a few at a time.
  useEffect(() => {
    const free = META_CONCURRENCY - metaProcessing.current.size;
    if (free <= 0) return;
    const pending = clips.filter(
      (c) => c.metaStatus === 'pending' && !metaProcessing.current.has(c.id),
    );
    for (const clip of pending.slice(0, free)) {
      metaProcessing.current.add(clip.id);
      loadClipMeta(clip.file, { thumbnail: false })
        .then((meta) =>
          updateClip(clip.id, (c) => ({ ...c, ...meta, metaStatus: 'ready' })),
        )
        .catch(() => updateClip(clip.id, (c) => ({ ...c, metaStatus: 'error' })))
        .finally(() => metaProcessing.current.delete(clip.id));
    }
  }, [clips]);

  // Swap the preview source when the active clip changes.
  useEffect(() => {
    const clip = clipsRef.current.find((c) => c.id === activeId);
    if (!clip) {
      setActiveUrl(null);
      return;
    }
    const url = URL.createObjectURL(clip.file);
    setActiveUrl(url);
    setActiveError(false);
    setActiveInfo({});
    setTime(0);
    setPlaying(false);
    return () => URL.revokeObjectURL(url);
  }, [activeId]);

  // Probe the active clip's container for codec + fps (best-effort).
  useEffect(() => {
    const clip = clipsRef.current.find((c) => c.id === activeId);
    if (!clip) return;
    let cancelled = false;
    probeContainer(clip.file).then((info) => {
      if (!cancelled) setActiveInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Keep transport state in sync with the element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      if (!scrubbingRef.current) setTime(v.currentTime);
    };
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
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
  }, [activeUrl]);

  // Revoke all thumbnails on unmount.
  useEffect(
    () => () => {
      for (const clip of clipsRef.current) {
        if (clip.thumbUrl) URL.revokeObjectURL(clip.thumbUrl);
      }
    },
    [],
  );

  // --- look picker --------------------------------------------------------

  async function applySelection(value: string) {
    setSelected(value);
    setCubeError(null);
    if (value === 'none') {
      setLut(null);
      return;
    }
    if (value === 'custom') {
      setLut(customLut);
      return;
    }
    const entry = BUILTIN_LUTS.find((l) => l.id === value);
    if (!entry) return;
    setBusy(true);
    try {
      const res = await fetch(entry.url);
      const parsed = parseCube(await res.text());
      if (!parsed) {
        setCubeError(`Could not parse ${entry.name}.`);
        setLut(null);
      } else {
        setLut(parsed);
      }
    } catch {
      setCubeError(`Could not load ${entry.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadCube() {
    const file = await pickFile(CUBE_ACCEPT);
    if (!file) return;
    setCubeError(null);
    const parsed = parseCube(await file.text());
    if (!parsed) {
      setCubeError(`${file.name} isn't a supported 3D .cube LUT (1D LUTs aren't supported).`);
      return;
    }
    setCustomLut(parsed);
    setCustomName(file.name);
    setLut(parsed);
    setSelected('custom');
  }

  // --- transport ----------------------------------------------------------

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  function handleScrub(value: number) {
    setTime(value);
    const v = videoRef.current;
    if (v) v.currentTime = value;
  }

  // --- before/after wipe --------------------------------------------------

  /**
   * Move the divider to `xNorm` (0..1 across the *canvas*, not the stage —
   * the canvas is usually letterboxed): set the shader split and lay the
   * visual line over the canvas. Done imperatively to stay smooth.
   */
  function placeWipe(xNorm: number) {
    const x = Math.min(1, Math.max(0, xNorm));
    splitXRef.current = x;
    setSplit(true, x);
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const line = wipeRef.current;
    if (!stage || !canvas || !line) return;
    const s = stage.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    line.style.left = `${c.left - s.left + x * c.width}px`;
    line.style.top = `${c.top - s.top}px`;
    line.style.height = `${c.height}px`;
  }

  function handleStagePointerMove(e: React.PointerEvent) {
    if (!compareOn || !activeUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getBoundingClientRect();
    placeWipe((e.clientX - c.left) / c.width);
  }

  function toggleCompare() {
    setCompareOn((on) => {
      if (!on) setBypass(false); // wipe needs the grade applied
      return !on;
    });
  }

  // Drive the shader split from `compareOn`. When on, re-seed the divider after
  // layout (a fresh renderer — new source/look — starts with the split off);
  // when off (including when bypass takes over), disable it so no wipe lingers.
  useEffect(() => {
    if (compareOn && activeUrl) {
      requestAnimationFrame(() => placeWipe(splitXRef.current));
    } else {
      setSplit(false, splitXRef.current);
    }
    // placeWipe/setSplit read live refs; only these inputs matter here.
  }, [compareOn, activeUrl, lut]);

  // --- export -------------------------------------------------------------

  async function handleExport() {
    const queue = clips.filter((c) => c.exportSelected);
    if (queue.length === 0 || exporting) return;
    setExporting(true);
    setBatchTotal(queue.length);
    setClips((prev) =>
      prev.map((c) =>
        c.exportSelected
          ? { ...c, exportStatus: 'queued', exportRatio: null, exportError: undefined }
          : c,
      ),
    );
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      await runBatchExport(
        queue.map((c) => ({ id: c.id, file: c.file, name: c.name })),
        lut,
        {
          onStart: (id) =>
            updateClip(id, (c) => ({ ...c, exportStatus: 'exporting', exportRatio: null })),
          onProgress: (id, p) =>
            updateClip(id, (c) => ({
              ...c,
              exportRatio: p.phase === 'encoding' ? p.ratio : c.exportRatio,
            })),
          onDone: (id) =>
            updateClip(id, (c) => ({ ...c, exportStatus: 'done', exportRatio: 1 })),
          onError: (id, message) =>
            updateClip(id, (c) => ({ ...c, exportStatus: 'error', exportError: message })),
        },
        controller.signal,
      );
    } finally {
      setExporting(false);
      exportAbort.current = null;
    }
  }

  function cancelExport() {
    exportAbort.current?.abort();
  }

  // --- derived ------------------------------------------------------------

  const selectedCount = clips.filter((c) => c.exportSelected).length;
  const doneCount = clips.filter((c) => c.exportStatus === 'done').length;
  const exportingClip = clips.find((c) => c.exportStatus === 'exporting');
  const overallRatio = batchTotal
    ? (doneCount + (exportingClip?.exportRatio ?? 0)) / batchTotal
    : 0;

  const activeRes =
    activeClip?.width && activeClip?.height
      ? `${activeClip.width}×${activeClip.height}`
      : null;
  const activeDetail = [
    activeRes,
    activeInfo.codec,
    activeInfo.fps ? `${activeInfo.fps} fps` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-4 mt-4"
      aria-label="LUT Studio"
    >
      <div className="grid grid-cols-[minmax(240px,26%)_1fr] gap-6 items-stretch flex-1 min-h-0 rounded-paper-lg max-[820px]:grid-cols-1">
        <aside className="flex flex-col gap-[0.9rem] min-w-0 min-h-0">
          {clips.length === 0 ? (
            <p className="m-0 text-[0.85rem] leading-[1.5] text-muted border-[1.5px] border-dashed border-line-strong rounded-paper p-4 bg-surface">
              Select video assets in the{' '}
              <strong className="text-ink-soft font-semibold">Library</strong> on
              the left to grade them. Pick one to preview a look; check the ones
              to export.
            </p>
          ) : (
            <ClipList
              clips={clips}
              activeId={activeId}
              onSelect={setActiveId}
              onToggleExport={(id) =>
                updateClip(id, (c) => ({ ...c, exportSelected: !c.exportSelected }))
              }
              onRemove={removeClip}
              onToggleAll={toggleAll}
            />
          )}
        </aside>

        <div className="min-w-0 min-h-0 flex flex-col gap-[0.6rem]">
          <div className="flex flex-wrap items-center gap-[0.75rem_1rem] mb-[1.1rem]">
            <label className="inline-flex items-center gap-2 font-mono text-[0.7rem] tracking-[0.12em] uppercase text-muted">
              <span>Look</span>
              <select
                className="font-sans text-[0.85rem] font-semibold tracking-normal normal-case text-ink bg-surface border border-line-strong rounded-paper px-[0.7rem] py-[0.45rem] cursor-pointer"
                value={selected}
                onChange={(e) => applySelection(e.target.value)}
                disabled={busy}
              >
                <option value="none">No LUT (original)</option>
                {UNGROUPED_LUTS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                {LUT_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.luts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {customName && <option value="custom">{customName} (uploaded)</option>}
              </select>
            </label>

            <button
              type="button"
              className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline"
              onClick={uploadCube}
            >
              Upload .cube
            </button>

            <button
              type="button"
              className="ml-auto border border-line-strong bg-paper text-ink-soft cursor-pointer text-[0.82rem] font-semibold px-[0.9rem] py-[0.45rem] rounded-full transition-[border-color,color] duration-200 ease-paper aria-pressed:border-accent aria-pressed:text-accent-ink disabled:opacity-50 disabled:cursor-default"
              onClick={toggleCompare}
              disabled={!lut}
              aria-pressed={compareOn}
              title="Drag a divider across the preview: grade on the left, original on the right"
            >
              {compareOn ? 'Comparing ⟷' : 'Compare ⟷'}
            </button>

            <button
              type="button"
              className="ml-0 border border-line-strong bg-paper text-ink-soft cursor-pointer text-[0.82rem] font-semibold px-[0.9rem] py-[0.45rem] rounded-full transition-[border-color,color] duration-200 ease-paper aria-pressed:border-accent aria-pressed:text-accent-ink disabled:opacity-50 disabled:cursor-default"
              onClick={() => {
                setBypass((b) => !b);
                setCompareOn(false);
              }}
              disabled={!lut}
              aria-pressed={bypass}
              title="Toggle between the graded and original image"
            >
              Viewing: {bypass || !lut ? 'Original' : 'Graded'}
            </button>
          </div>

          {activeClip && (
            <p
              className="flex items-baseline gap-[0.7rem] m-0 min-w-0"
              title={activeClip.name}
            >
              <span className="font-semibold text-[0.9rem] whitespace-nowrap overflow-hidden text-ellipsis">
                {activeClip.name}
              </span>
              {activeDetail && (
                <span className="font-mono text-[0.72rem] tracking-[0.02em] text-muted flex-none">
                  {activeDetail}
                </span>
              )}
            </p>
          )}

          <div
            ref={stageRef}
            className={`relative rounded-paper overflow-hidden flex-1 min-h-0 flex items-center justify-center max-[820px]:min-h-[240px] ${
              activeUrl ? 'bg-frame cursor-pointer' : 'bg-transparent cursor-default'
            }${compareOn ? ' cursor-ew-resize' : ''}`}
            onClick={activeUrl && !compareOn ? togglePlay : undefined}
            onPointerMove={handleStagePointerMove}
            title={
              activeUrl && !compareOn ? (playing ? 'Pause' : 'Play') : undefined
            }
          >
            {activeUrl && compareOn && (
              <div
                ref={wipeRef}
                className="absolute w-0.5 -ml-px bg-white/90 shadow-[0_0_0_0.5px_rgba(0,0,0,0.4)] pointer-events-none z-[2]"
                aria-hidden="true"
              >
                <span className="absolute top-1/2 left-1/2 w-[34px] h-[34px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/95 bg-black/[0.32] shadow-[0_1px_6px_rgba(0,0,0,0.45)] before:content-[''] before:absolute before:top-1/2 before:left-2 before:w-1.5 before:h-1.5 before:border-t-2 before:border-r-2 before:border-white/95 before:-translate-y-1/2 before:-rotate-[135deg] after:content-[''] after:absolute after:top-1/2 after:right-2 after:w-1.5 after:h-1.5 after:border-t-2 after:border-r-2 after:border-white/95 after:-translate-y-1/2 after:rotate-45" />
                <span className="absolute top-2.5 right-2.5 font-mono text-[0.62rem] tracking-[0.08em] uppercase text-white bg-black/55 px-[0.4rem] py-[0.18rem] rounded-[5px] whitespace-nowrap">
                  Graded
                </span>
                <span className="absolute top-2.5 left-2.5 font-mono text-[0.62rem] tracking-[0.08em] uppercase text-white bg-black/55 px-[0.4rem] py-[0.18rem] rounded-[5px] whitespace-nowrap">
                  Original
                </span>
              </div>
            )}
            {activeUrl ? (
              <canvas
                ref={canvasRef}
                className="block w-auto h-auto max-w-full max-h-full object-contain bg-frame"
              />
            ) : (
              <div className="w-full aspect-video flex items-center justify-center bg-surface border border-line rounded-paper text-muted text-center p-4 font-mono text-[0.85rem]">
                {clips.length === 0
                  ? 'Select a video in the Library.'
                  : 'Select a clip to preview.'}
              </div>
            )}
            {/* Offscreen decoder + audio source. Kept rendered (not
                display:none) so the browser keeps producing frames. */}
            <video
              ref={videoRef}
              src={activeUrl ?? undefined}
              className="absolute w-0.5 h-0.5 left-0 bottom-0 opacity-0 pointer-events-none"
              playsInline
              onError={() => setActiveError(true)}
            />
          </div>

          {activeUrl && (
            <div className="flex items-center gap-[0.85rem] mt-[0.9rem] px-[0.85rem] py-[0.6rem] border border-line rounded-paper bg-surface">
              <button
                type="button"
                className="flex-none w-[2.2rem] h-[2.2rem] border-0 rounded-full bg-ink text-paper cursor-pointer text-[0.8rem] leading-none inline-flex items-center justify-center transition-[background-color] duration-200 ease-paper hover:bg-accent"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span
                className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center"
                title="Current position"
              >
                {formatTimecode(time)}
              </span>
              <input
                type="range"
                className="flex-1 accent-accent cursor-pointer"
                min={0}
                max={duration || 0}
                step={0.001}
                value={Math.min(time, duration || 0)}
                onPointerDown={() => {
                  scrubbingRef.current = true;
                }}
                onPointerUp={() => {
                  scrubbingRef.current = false;
                }}
                onPointerCancel={() => {
                  scrubbingRef.current = false;
                }}
                onBlur={() => {
                  scrubbingRef.current = false;
                }}
                onChange={(e) => handleScrub(Number(e.target.value))}
                aria-label="Seek"
              />
              <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
                {formatDuration(duration)}
              </span>
            </div>
          )}

          {!supported && (
            <p className="my-4 px-4 py-[0.85rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.86rem] leading-[1.55]">
              Your browser doesn't expose <strong>WebGL2</strong>, which the LUT
              preview needs. Try a recent Chrome, Edge, Firefox or Safari.
            </p>
          )}

          {activeError && (
            <p className="my-4 px-4 py-[0.85rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.86rem] leading-[1.55]">
              This clip failed to decode. DJI footage is often HEVC/H.265, which
              not every browser plays natively — try Safari (best HEVC support)
              or transcode to H.264.
            </p>
          )}

          {cubeError && (
            <p className="my-4 px-4 py-[0.85rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.86rem] leading-[1.55]">
              {cubeError}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-line pt-4 flex-none">
        {exporting ? (
          <>
            <div
              className="flex items-center gap-[0.85rem] mt-0 flex-1"
              role="status"
            >
              <span className="font-mono text-[0.74rem] tracking-[0.04em] text-ink-soft flex-none min-w-[11ch]">
                Exporting {Math.min(doneCount + 1, batchTotal)}/{batchTotal}
              </span>
              <progress
                data-export
                className="flex-1 h-2 accent-accent"
                value={overallRatio}
                max={1}
              />
            </div>
            <button
              type="button"
              className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline"
              onClick={cancelExport}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!exportSupported && clips.length > 0 && (
              <span className="mr-auto text-[0.78rem] text-muted">
                Export needs WebCodecs (try Chrome/Edge) — preview works
                everywhere.
              </span>
            )}
            <button
              type="button"
              className="mt-0 px-[1.1rem] py-2 inline-flex items-center justify-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.82rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent hover:text-white active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
              onClick={handleExport}
              disabled={selectedCount === 0 || !exportSupported}
              title="Render graded copies of the checked clips (H.264 MP4)"
            >
              Export {selectedCount || ''} MP4{selectedCount === 1 ? '' : 's'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
