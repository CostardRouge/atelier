import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaPair } from './pair-files';
import { parseSrt, type Cue } from './srt-parser';
import { summarizeTelemetry } from './telemetry-summary';
import { formatBytes, formatDuration } from '../../shared/lib/format';
import { pickFile, SRT_ACCEPT, VIDEO_ACCEPT } from '../../shared/sources/file-sources';
import { useActiveCue } from './use-active-cue';
import { LiveTelemetry } from './telemetry-view';

interface VideoCardProps {
  pair: MediaPair;
  onOpen: (pair: MediaPair) => void;
  /** Position in the gallery, for the small plate label. */
  index?: number;
  /** Attach a user-chosen file to this pair's missing slot. */
  onAttach: (pair: MediaPair, file: File) => void;
  /** Undo an attachment for the given slot. */
  onDetach: (pair: MediaPair, kind: 'video' | 'srt') => void;
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

export default function VideoCard({
  pair,
  onOpen,
  index,
  onAttach,
  onDetach,
}: VideoCardProps) {
  const [ref, inView] = useInViewport<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // undefined = not loaded yet, null = unavailable (e.g. HEVC).
  const [duration, setDuration] = useState<number | null | undefined>(undefined);
  // undefined = parsing, null = no/unreadable SRT, Cue[] = parsed track.
  const [cues, setCues] = useState<Cue[] | null | undefined>(undefined);
  const [videoError, setVideoError] = useState(false);

  const { video, srt } = pair;

  // Create the object URL only when the card is visible and a video exists;
  // revoke on unmount or when the video changes. Never hold 50 URLs open.
  useEffect(() => {
    if (!inView || !video) return;
    setVideoError(false);
    setDuration(undefined);
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setVideoUrl(null);
    };
  }, [inView, video]);

  // Parse the (small, text) SRT lazily once visible.
  useEffect(() => {
    if (!inView) return;
    if (!srt) {
      setCues(null);
      return;
    }
    let cancelled = false;
    setCues(undefined);
    srt
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
  }, [inView, srt]);

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

  async function handleAdd(kind: 'video' | 'srt') {
    const file = await pickFile(kind === 'video' ? VIDEO_ACCEPT : SRT_ACCEPT);
    if (file) onAttach(pair, file);
  }

  const title = video?.name ?? srt?.name ?? pair.baseName;

  return (
    <div
      className="flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper-soft transition-[transform,box-shadow,border-color] duration-300 ease-paper hover:-translate-y-1 hover:shadow-paper hover:border-line-strong"
      ref={ref}
    >
      <div className="relative bg-frame leading-[0]">
        {index != null && (
          <span className="absolute top-[0.7rem] left-[0.7rem] z-[2] font-mono text-[0.64rem] tracking-[0.12em] px-2 py-[0.22rem] rounded-full bg-[rgba(20,18,15,0.55)] text-paper backdrop-blur-[4px] leading-[1.4]">
            NO. {String(index + 1).padStart(2, '0')}
          </span>
        )}
        {hasTrack && liveAlt && (
          <span
            className="absolute top-[0.7rem] right-[0.7rem] z-[2] inline-flex items-center gap-[0.4rem] font-mono text-[0.74rem] font-medium tracking-[0.02em] px-[0.6rem] py-[0.24rem] rounded-full bg-[rgba(20,18,15,0.55)] text-white backdrop-blur-[4px] leading-[1.4]"
            aria-hidden="true"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot motion-reduce:animate-none" />
            {liveAlt} m
          </span>
        )}
        {video ? (
          videoUrl && !videoError ? (
            <video
              ref={videoRef}
              className="block w-full aspect-video bg-frame"
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
            <div className="w-full aspect-video flex items-center justify-center bg-frame text-[#8c8576] text-[0.78rem] text-center p-4 font-mono leading-[1.5]">
              {videoError
                ? 'Playback unavailable (codec not supported by this browser)'
                : '…'}
            </div>
          )
        ) : (
          <div className="w-full aspect-video flex flex-col items-center justify-center gap-[0.85rem] bg-paper-2 text-[#8c8576] text-[0.78rem] text-center p-4 font-mono leading-[1.5]">
            <span>No video for this telemetry yet.</span>
            <button
              className="px-[0.9rem] py-2 border border-accent rounded-paper bg-accent-wash text-accent-ink cursor-pointer font-semibold text-[0.82rem] transition-[background-color,transform] duration-200 ease-paper hover:bg-accent hover:text-white hover:-translate-y-px"
              onClick={() => handleAdd('video')}
            >
              Add video
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[0.9rem] flex-1 p-[1.1rem_1.2rem_1.2rem]">
        <h3
          className="m-0 text-base font-semibold tracking-[-0.01em] whitespace-nowrap overflow-hidden text-ellipsis"
          title={title}
        >
          {title}
        </h3>

        {pair.videoNameMismatch && (
          <p className="m-0 px-[0.65rem] py-2 rounded-paper bg-accent-wash border border-line-strong text-accent-ink text-[0.76rem] leading-[1.45]">
            ⚠ Video name doesn’t match (
            <code className="font-mono text-ink break-all">{video?.name}</code>{' '}
            vs <code className="font-mono text-ink break-all">{pair.baseName}</code>
            ).{' '}
            <button
              className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline"
              onClick={() => onDetach(pair, 'video')}
            >
              Remove
            </button>
          </p>
        )}
        {pair.srtNameMismatch && (
          <p className="m-0 px-[0.65rem] py-2 rounded-paper bg-accent-wash border border-line-strong text-accent-ink text-[0.76rem] leading-[1.45]">
            ⚠ Telemetry name doesn’t match (
            <code className="font-mono text-ink break-all">{srt?.name}</code> vs{' '}
            <code className="font-mono text-ink break-all">{pair.baseName}</code>
            ).{' '}
            <button
              className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline"
              onClick={() => onDetach(pair, 'srt')}
            >
              Remove
            </button>
          </p>
        )}

        {video && (
          <p className="mt-[-0.3rem] mb-0 font-mono text-[0.74rem] tracking-[0.02em] text-muted flex items-center gap-2">
            {formatBytes(video.size)}
            <span className="text-faint">·</span>
            {duration === undefined ? '…' : formatDuration(duration)}
          </p>
        )}

        {srt ? (
          cues === undefined ? (
            <p className="m-0 text-[0.82rem] text-muted">Reading telemetry…</p>
          ) : hasTrack ? (
            <>
              <LiveTelemetry cue={liveCue} />
              {summary && (
                <p className="m-0 font-mono text-[0.7rem] tracking-[0.02em] text-muted flex flex-wrap items-center gap-[0.45rem]">
                  {summary.cueCount} frames
                  {summary.relAltMin !== null && summary.relAltMax !== null && (
                    <>
                      <span className="text-faint">·</span>
                      {summary.relAltMin.toFixed(0)}–
                      {summary.relAltMax.toFixed(0)} m
                    </>
                  )}
                  {summary.colorProfile && (
                    <>
                      <span className="text-faint">·</span>
                      {summary.colorProfile}
                    </>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="m-0 text-[0.82rem] text-muted">Telemetry unreadable.</p>
          )
        ) : (
          <p className="m-0 text-[0.82rem] text-muted">
            No .srt — telemetry unavailable.{' '}
            <button
              className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline"
              onClick={() => handleAdd('srt')}
            >
              Add telemetry
            </button>
          </p>
        )}

        {(video || srt) && (
          <button
            className="mt-auto px-4 py-[0.7rem] inline-flex items-center justify-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.85rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent hover:text-white active:scale-[0.98]"
            onClick={() => onOpen(pair)}
          >
            {srt && video
              ? 'Open full view'
              : srt
                ? 'Open telemetry'
                : 'Open video'}
          </button>
        )}
      </div>
    </div>
  );
}
