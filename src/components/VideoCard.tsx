import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaPair } from '../lib/pair-files';
import { parseSrt, type Cue } from '../lib/srt-parser';
import { summarizeTelemetry } from '../lib/telemetry-summary';
import { formatBytes, formatDuration } from '../lib/format';
import { useActiveCue } from '../hooks/use-active-cue';
import { LiveTelemetry } from './telemetry-view';

interface VideoCardProps {
  pair: MediaPair;
  onOpen: (pair: MediaPair) => void;
  /** Position in the gallery, for the small plate label. */
  index?: number;
}

/**
 * Observe whether an element has entered the viewport. Used to defer all heavy
 * work (object URL, metadata, SRT parsing) until a card is actually visible, so
 * the initial render stays instant even with many files.
 */
function useInViewport<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  return [ref, inView];
}

export default function VideoCard({ pair, onOpen, index }: VideoCardProps) {
  const [ref, inView] = useInViewport<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // undefined = not loaded yet, null = unavailable (e.g. HEVC).
  const [duration, setDuration] = useState<number | null | undefined>(undefined);
  // undefined = parsing, null = no/unreadable SRT, Cue[] = parsed track.
  const [cues, setCues] = useState<Cue[] | null | undefined>(undefined);
  const [videoError, setVideoError] = useState(false);

  // Create the object URL only when the card is visible; revoke on unmount or
  // when the pair changes. Never hold 50 object URLs open at once.
  useEffect(() => {
    if (!inView) return;
    const url = URL.createObjectURL(pair.video);
    setVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setVideoUrl(null);
    };
  }, [inView, pair.video]);

  // Parse the (small, text) SRT lazily once visible.
  useEffect(() => {
    if (!inView) return;
    if (!pair.srt) {
      setCues(null);
      return;
    }
    let cancelled = false;
    pair.srt
      .text()
      .then((text) => {
        if (!cancelled) setCues(parseSrt(text));
      })
      .catch(() => {
        if (!cancelled) setCues(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inView, pair.srt]);

  const hasTrack = Array.isArray(cues) && cues.length > 0;
  const summary = useMemo(
    () => (hasTrack ? summarizeTelemetry(cues as Cue[]) : null),
    [cues, hasTrack],
  );

  // Live cue follows the inline video; before playback it shows the opening
  // frame, so the card never reads as empty.
  const activeCue = useActiveCue(videoRef, hasTrack ? (cues as Cue[]) : [], videoUrl);
  const liveCue = hasTrack ? activeCue ?? (cues as Cue[])[0] : null;
  const liveAlt = liveCue?.data.rel_alt;

  return (
    <div className="card" ref={ref}>
      <div className="card-frame">
        {index != null && (
          <span className="card-plate">
            NO. {String(index + 1).padStart(2, '0')}
          </span>
        )}
        {hasTrack && liveAlt && (
          <span className="card-hud" aria-hidden="true">
            <span className="card-hud-dot" />
            {liveAlt} m
          </span>
        )}
        {videoUrl && !videoError ? (
          <video
            ref={videoRef}
            className="card-video"
            src={videoUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              setDuration(Number.isFinite(d) ? d : null);
            }}
            onError={() => {
              setVideoError(true);
              setDuration(null);
            }}
          />
        ) : (
          <div className="card-video placeholder">
            {videoError
              ? 'Playback unavailable (codec not supported by this browser)'
              : '…'}
          </div>
        )}
      </div>

      <div className="card-body">
        <h3 className="card-title" title={pair.video.name}>
          {pair.video.name}
        </h3>

        <p className="card-caption">
          {formatBytes(pair.video.size)}
          <span className="sep">·</span>
          {duration === undefined ? '…' : formatDuration(duration)}
        </p>

        {pair.srt ? (
          cues === undefined ? (
            <p className="card-note">Reading telemetry…</p>
          ) : hasTrack ? (
            <>
              <LiveTelemetry cue={liveCue} />
              {summary && (
                <p className="card-summary">
                  {summary.cueCount} frames
                  {summary.relAltMin !== null && summary.relAltMax !== null && (
                    <>
                      <span className="sep">·</span>
                      {summary.relAltMin.toFixed(0)}–
                      {summary.relAltMax.toFixed(0)} m
                    </>
                  )}
                  {summary.colorProfile && (
                    <>
                      <span className="sep">·</span>
                      {summary.colorProfile}
                    </>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="card-note">Telemetry unreadable.</p>
          )
        ) : (
          <p className="card-note">No .srt — telemetry unavailable.</p>
        )}

        <button className="open-btn" onClick={() => onOpen(pair)}>
          {pair.srt ? 'Open full view' : 'Open video'}
        </button>
      </div>
    </div>
  );
}
