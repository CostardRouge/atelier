import { useEffect, useRef, useState } from 'react';
import type { MediaPair } from '../lib/pair-files';
import { parseSrt } from '../lib/srt-parser';
import { summarizeTelemetry, type TelemetrySummary } from '../lib/telemetry-summary';
import { formatBytes, formatDuration } from '../lib/format';

interface VideoCardProps {
  pair: MediaPair;
  onOpen: (pair: MediaPair) => void;
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

export default function VideoCard({ pair, onOpen }: VideoCardProps) {
  const [ref, inView] = useInViewport<HTMLDivElement>();

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // undefined = not loaded yet, null = unavailable (e.g. HEVC).
  const [duration, setDuration] = useState<number | null | undefined>(undefined);
  const [summary, setSummary] = useState<TelemetrySummary | null | undefined>(
    undefined,
  );
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
      setSummary(null);
      return;
    }
    let cancelled = false;
    pair.srt
      .text()
      .then((text) => {
        if (!cancelled) setSummary(summarizeTelemetry(parseSrt(text)));
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inView, pair.srt]);

  return (
    <div className="card" ref={ref}>
      {videoUrl && !videoError ? (
        <video
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
            ? 'Lecture indisponible (codec non supporté par le navigateur)'
            : '…'}
        </div>
      )}

      <div className="card-body">
        <h3 className="card-title" title={pair.video.name}>
          {pair.video.name}
        </h3>

        <dl className="card-meta">
          <dt>Taille</dt>
          <dd>{formatBytes(pair.video.size)}</dd>

          <dt>Durée</dt>
          <dd>
            {duration === undefined ? '…' : formatDuration(duration)}
          </dd>

          {pair.srt ? (
            summary === undefined ? (
              <>
                <dt>Télémétrie</dt>
                <dd>…</dd>
              </>
            ) : summary ? (
              <>
                <dt>Frames</dt>
                <dd>{summary.cueCount}</dd>
                <dt>Altitude rel.</dt>
                <dd>
                  {summary.relAltMin !== null && summary.relAltMax !== null
                    ? `${summary.relAltMin.toFixed(1)}–${summary.relAltMax.toFixed(1)} m`
                    : '—'}
                </dd>
                <dt>Départ</dt>
                <dd>
                  {summary.startLatitude && summary.startLongitude
                    ? `${summary.startLatitude}, ${summary.startLongitude}`
                    : '—'}
                </dd>
                <dt>Profil</dt>
                <dd>{summary.colorProfile ?? '—'}</dd>
              </>
            ) : (
              <>
                <dt>Télémétrie</dt>
                <dd className="empty">illisible</dd>
              </>
            )
          ) : (
            <>
              <dt>Télémétrie</dt>
              <dd className="empty">aucun .srt</dd>
            </>
          )}
        </dl>

        <button className="open-btn" onClick={() => onOpen(pair)}>
          {pair.srt ? 'Ouvrir avec télémétrie' : 'Ouvrir la vidéo'}
        </button>
      </div>
    </div>
  );
}
