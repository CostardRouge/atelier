import { useEffect, useRef, useState } from 'react';
import type { Cue } from '../lib/srt-parser';
import { findCue } from '../lib/find-cue';

interface TelemetryPlayerProps {
  /** Object URL for the selected video, or null if none chosen. */
  videoUrl: string | null;
  /** Parsed telemetry cues (sorted by start), empty if no SRT loaded. */
  cues: Cue[];
}

/** Format a raw value with a unit suffix, tolerating missing data. */
function fmt(value: string | undefined, suffix = ''): string {
  if (value === undefined || value === '') return '—';
  return suffix ? `${value}${suffix}` : value;
}

function Field({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string | undefined;
  suffix?: string;
  highlight?: boolean;
}) {
  const display = fmt(value, suffix);
  const empty = display === '—';
  return (
    <div className={highlight ? 'highlight' : undefined} style={{ display: 'contents' }}>
      <dt>{label}</dt>
      <dd className={empty ? 'empty' : undefined}>{display}</dd>
    </div>
  );
}

export default function TelemetryPlayer({ videoUrl, cues }: TelemetryPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cue, setCue] = useState<Cue | null>(null);
  const [videoError, setVideoError] = useState(false);

  // Keep the latest cues/current-cue in refs so the frame callback closure
  // stays stable and we can compare without re-subscribing every render.
  const cuesRef = useRef(cues);
  const currentCueRef = useRef<Cue | null>(null);
  cuesRef.current = cues;

  // Reset when the source changes.
  useEffect(() => {
    currentCueRef.current = null;
    setCue(null);
    setVideoError(false);
  }, [videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Only update React state when the active cue actually changes — not on
    // every frame — to keep DOM churn minimal.
    const update = (t: number) => {
      const next = findCue(cuesRef.current, t);
      if (next !== currentCueRef.current) {
        currentCueRef.current = next;
        setCue(next);
      }
    };

    const supportsRVFC =
      typeof video.requestVideoFrameCallback === 'function';

    let rvfcHandle = 0;
    let cancelled = false;

    if (supportsRVFC) {
      // Preferred path: mediaTime is the exact presentation time of the
      // displayed frame — the right granularity for per-frame telemetry.
      const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (cancelled) return;
        update(metadata.mediaTime);
        rvfcHandle = video.requestVideoFrameCallback(onFrame);
      };
      rvfcHandle = video.requestVideoFrameCallback(onFrame);
    }

    // Fallback (and a backstop while paused): timeupdate + currentTime.
    const onTimeUpdate = () => update(video.currentTime);
    video.addEventListener('timeupdate', onTimeUpdate);
    const onSeeked = () => update(video.currentTime);
    video.addEventListener('seeked', onSeeked);

    return () => {
      cancelled = true;
      if (supportsRVFC && rvfcHandle) {
        video.cancelVideoFrameCallback(rvfcHandle);
      }
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [videoUrl]);

  const d = cue?.data ?? {};

  return (
    <div>
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          onError={() => setVideoError(true)}
        />
      ) : (
        <div className="placeholder">
          Select a video file to begin.
        </div>
      )}

      {videoError && (
        <p className="notice">
          The video failed to play. DJI clips are often HEVC/H.265, which not
          every browser decodes natively. The telemetry below still works if
          the SRT loaded — try another browser (Safari handles HEVC best) or
          transcode the clip to H.264.
        </p>
      )}

      {videoUrl && cues.length === 0 && (
        <p className="notice">
          No telemetry loaded yet — select the matching <code>.srt</code> file.
        </p>
      )}

      <div className="panels">
        <section className="panel">
          <h2>Flight</h2>
          <dl>
            <Field label="Rel. altitude" value={d.rel_alt} suffix=" m" highlight />
            <Field label="Abs. altitude" value={d.abs_alt} suffix=" m" />
            <Field label="Latitude" value={d.latitude} />
            <Field label="Longitude" value={d.longitude} />
            <Field label="FrameCnt" value={cue?.frame != null ? String(cue.frame) : undefined} />
            <Field label="Timestamp" value={cue?.timestamp ?? undefined} />
          </dl>
        </section>

        <section className="panel">
          <h2>Camera</h2>
          <dl>
            <Field label="ISO" value={d.iso} />
            <Field label="Shutter" value={d.shutter} />
            <Field label="Aperture" value={d.fnum ? `f/${d.fnum}` : undefined} />
            <Field label="EV" value={d.ev} />
            <Field label="Focal length" value={d.focal_len} suffix=" mm" />
            <Field label="Color profile" value={d.color_md} />
            <Field label="Color temp." value={d.ct} suffix=" K" />
          </dl>
        </section>
      </div>
    </div>
  );
}
