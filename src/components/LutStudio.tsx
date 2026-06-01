import { useEffect, useRef, useState } from 'react';
import { parseCube, type CubeLut } from '../lib/cube-parser';
import { formatDuration } from '../lib/format';
import { BUILTIN_LUTS } from '../lut/builtin-luts';
import { useLutPreview } from '../hooks/use-lut-preview';
import { CUBE_ACCEPT, VIDEO_ACCEPT, pickFile } from '../sources/file-sources';

/**
 * LUT Studio — preview a `.cube` colour grade on a video in real time.
 *
 * The `<video>` (kept offscreen, never `display:none` so it keeps decoding)
 * feeds frames to a WebGL2 canvas via {@link useLutPreview}; custom transport
 * controls drive that same element. Nothing uploads — files stay on the
 * machine, same as the telemetry side.
 */
export default function LutStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);

  const [lut, setLut] = useState<CubeLut | null>(null);
  const [selected, setSelected] = useState('none'); // 'none' | builtin id | 'custom'
  const [customLut, setCustomLut] = useState<CubeLut | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [cubeError, setCubeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bypass, setBypass] = useState(false);

  // Transport state, mirrored from the offscreen video element.
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const { supported } = useLutPreview(videoRef, canvasRef, lut, bypass, videoUrl);

  // Revoke the previous object URL when the source changes or on unmount.
  useEffect(
    () => () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl],
  );

  // Keep transport state in sync with the element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(v.currentTime);
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
  }, [videoUrl]);

  async function chooseVideo() {
    const file = await pickFile(VIDEO_ACCEPT);
    if (!file) return;
    setVideoUrl(URL.createObjectURL(file)); // previous URL revoked by the effect
    setVideoName(file.name);
    setVideoError(false);
    setTime(0);
    setPlaying(false);
  }

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
      const text = await res.text();
      const parsed = parseCube(text);
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

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  function seek(value: number) {
    const v = videoRef.current;
    if (v) v.currentTime = value;
  }

  return (
    <section aria-label="LUT Studio">
      <div className="collection-head">
        <span className="title">LUT Studio</span>
        <p className="count">Real-time preview · nothing uploads</p>
      </div>

      <div className="lut-toolbar">
        <button type="button" className="add-btn" onClick={chooseVideo}>
          {videoName ? 'Change video' : 'Choose video'}
        </button>

        <label className="lut-select">
          <span>Look</span>
          <select
            value={selected}
            onChange={(e) => applySelection(e.target.value)}
            disabled={busy}
          >
            <option value="none">No LUT (original)</option>
            {BUILTIN_LUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
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
          onClick={() => setBypass((b) => !b)}
          disabled={!lut}
          aria-pressed={bypass}
          title="Toggle between the graded and original image"
        >
          Viewing: {bypass || !lut ? 'Original' : 'Graded'}
        </button>
      </div>

      {videoName && <p className="card-caption">{videoName}</p>}

      <div className="lut-stage">
        {videoUrl ? (
          <canvas ref={canvasRef} className="lut-canvas" />
        ) : (
          <div className="placeholder">Choose a video to begin.</div>
        )}
        {/* Offscreen decoder + audio source. Kept rendered (not display:none) so
            the browser keeps producing frames for the canvas. */}
        <video
          ref={videoRef}
          src={videoUrl ?? undefined}
          className="lut-source"
          playsInline
          onError={() => setVideoError(true)}
        />
      </div>

      {videoUrl && (
        <div className="lut-transport">
          <button
            type="button"
            className="lut-play"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="lut-time">{formatDuration(time)}</span>
          <input
            type="range"
            className="lut-scrub"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(time, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
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

      {videoError && (
        <p className="notice">
          The video failed to decode. DJI clips are often HEVC/H.265, which not
          every browser plays natively — try Safari (best HEVC support) or
          transcode the clip to H.264.
        </p>
      )}

      {cubeError && <p className="notice">{cubeError}</p>}
    </section>
  );
}
