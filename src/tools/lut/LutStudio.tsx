import { useEffect, useRef, useState } from 'react';
import { parseCube, type CubeLut } from '../../shared/lib/cube-parser';
import { formatDuration } from '../../shared/lib/format';
import { BUILTIN_LUTS, LUT_GROUPS, UNGROUPED_LUTS } from './builtin-luts';
import { isExportSupported } from './export-video';
import { runBatchExport } from './batch-export';
import { clipId, type Clip } from './clip';
import {
  filterVideos,
  loadClipMeta,
  probeContainer,
  type ContainerInfo,
} from './video-metadata';
import { useLutPreview } from './use-lut-preview';
import {
  CUBE_ACCEPT,
  filesFromDataTransfer,
  pickDirectory,
  pickFile,
  pickFiles,
} from '../../shared/sources/file-sources';
import ClipList from './ClipList';

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

  const [clips, setClips] = useState<Clip[]>([]);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [activeError, setActiveError] = useState(false);
  const [activeInfo, setActiveInfo] = useState<ContainerInfo>({});
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);

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

  function addFiles(files: File[]) {
    const videos = filterVideos(files);
    if (videos.length === 0) return;
    setClips((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      const additions: Clip[] = [];
      for (const file of videos) {
        const id = clipId(file);
        if (seen.has(id)) continue;
        seen.add(id);
        additions.push({
          id,
          file,
          name: file.name,
          size: file.size,
          metaStatus: 'pending',
          exportSelected: true,
          exportStatus: 'idle',
          exportRatio: null,
        });
      }
      return additions.length ? [...prev, ...additions] : prev;
    });
  }

  async function runImport(pick: () => Promise<File[]>) {
    setImporting(true);
    try {
      addFiles(await pick());
    } finally {
      setImporting(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    setImporting(true);
    try {
      addFiles(await filesFromDataTransfer(e.dataTransfer));
    } finally {
      setImporting(false);
    }
  }

  function removeClip(id: string) {
    const target = clipsRef.current.find((c) => c.id === id);
    if (target?.thumbUrl) URL.revokeObjectURL(target.thumbUrl);
    setClips((prev) => prev.filter((c) => c.id !== id));
    setActiveId((prev) => {
      if (prev !== id) return prev;
      const remaining = clipsRef.current.filter((c) => c.id !== id);
      return remaining[0]?.id ?? null;
    });
  }

  function toggleAll(checked: boolean) {
    setClips((prev) => prev.map((c) => ({ ...c, exportSelected: checked })));
  }

  // --- effects ------------------------------------------------------------

  // Pick a default active clip whenever there's a list but nothing selected.
  useEffect(() => {
    if (activeId === null && clips.length > 0) setActiveId(clips[0].id);
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
      loadClipMeta(clip.file)
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
    <section className="lut-studio-page" aria-label="LUT Studio">
      <div className="collection-head">
        <span className="title">LUT Studio</span>
        <p className="count">
          {clips.length} clip{clips.length === 1 ? '' : 's'} · real-time preview,
          nothing uploads
        </p>
      </div>

      <div
        className={`lut-layout${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <aside className="lut-aside">
          <div className="lut-import">
            <button
              type="button"
              className="add-btn"
              onClick={() => runImport(pickFiles)}
              disabled={importing}
            >
              {importing ? 'Opening…' : 'Add videos'}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => runImport(pickDirectory)}
              disabled={importing}
            >
              or a folder
            </button>
          </div>

          {clips.length === 0 ? (
            <p className="lut-empty-hint">
              Add clips or drag them here. Pick one to preview a look; check the
              ones you want to export.
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

        <div className="lut-main">
          <div className="lut-toolbar">
            <label className="lut-select">
              <span>Look</span>
              <select
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

            <button type="button" className="link-btn" onClick={uploadCube}>
              Upload .cube
            </button>

            <button
              type="button"
              className="lut-compare"
              onClick={toggleCompare}
              disabled={!lut}
              aria-pressed={compareOn}
              title="Drag a divider across the preview: grade on the left, original on the right"
            >
              {compareOn ? 'Comparing ⟷' : 'Compare ⟷'}
            </button>

            <button
              type="button"
              className="lut-compare"
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
            <p className="lut-active-detail" title={activeClip.name}>
              <span className="lut-active-name">{activeClip.name}</span>
              {activeDetail && <span className="lut-active-specs">{activeDetail}</span>}
            </p>
          )}

          <div
            ref={stageRef}
            className={`lut-stage${activeUrl ? '' : ' empty'}${compareOn ? ' comparing' : ''}`}
            onClick={activeUrl && !compareOn ? togglePlay : undefined}
            onPointerMove={handleStagePointerMove}
            title={
              activeUrl && !compareOn ? (playing ? 'Pause' : 'Play') : undefined
            }
          >
            {activeUrl && compareOn && (
              <div ref={wipeRef} className="lut-wipe" aria-hidden="true">
                <span className="lut-wipe-handle" />
                <span className="lut-wipe-tag left">Graded</span>
                <span className="lut-wipe-tag right">Original</span>
              </div>
            )}
            {activeUrl ? (
              <canvas ref={canvasRef} className="lut-canvas" />
            ) : (
              <div className="placeholder">
                {clips.length === 0
                  ? 'Add videos to begin.'
                  : 'Select a clip to preview.'}
              </div>
            )}
            {/* Offscreen decoder + audio source. Kept rendered (not
                display:none) so the browser keeps producing frames. */}
            <video
              ref={videoRef}
              src={activeUrl ?? undefined}
              className="lut-source"
              playsInline
              onError={() => setActiveError(true)}
            />
          </div>

          {activeUrl && (
            <div className="lut-transport">
              <button
                type="button"
                className="lut-play"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span className="lut-time" title="Current position">
                {formatTimecode(time)}
              </span>
              <input
                type="range"
                className="lut-scrub"
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
              <span className="lut-time">{formatDuration(duration)}</span>
            </div>
          )}

          {!supported && (
            <p className="notice">
              Your browser doesn't expose <strong>WebGL2</strong>, which the LUT
              preview needs. Try a recent Chrome, Edge, Firefox or Safari.
            </p>
          )}

          {activeError && (
            <p className="notice">
              This clip failed to decode. DJI footage is often HEVC/H.265, which
              not every browser plays natively — try Safari (best HEVC support)
              or transcode to H.264.
            </p>
          )}

          {cubeError && <p className="notice">{cubeError}</p>}
        </div>
      </div>

      <div className="lut-footer">
        {exporting ? (
          <>
            <div className="lut-export-status" role="status">
              <span className="lut-export-label">
                Exporting {Math.min(doneCount + 1, batchTotal)}/{batchTotal}
              </span>
              <progress className="lut-export-bar" value={overallRatio} max={1} />
            </div>
            <button type="button" className="link-btn" onClick={cancelExport}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {!exportSupported && clips.length > 0 && (
              <span className="lut-export-note">
                Export needs WebCodecs (try Chrome/Edge) — preview works
                everywhere.
              </span>
            )}
            <button
              type="button"
              className="open-btn lut-export"
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
