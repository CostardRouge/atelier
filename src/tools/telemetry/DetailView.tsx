import { useEffect, useState } from 'react';
import type { MediaPair } from './pair-files';
import { parseSrt, type Cue } from './srt-parser';
import { pickFile, SRT_ACCEPT, VIDEO_ACCEPT } from '../../shared/sources/file-sources';
import { useTranscode } from '../../shared/media/use-transcode';
import TelemetryPlayer from './TelemetryPlayer';

interface DetailViewProps {
  pair: MediaPair;
  onBack: () => void;
  onAttach: (pair: MediaPair, file: File) => void;
  onDetach: (pair: MediaPair, kind: 'video' | 'srt') => void;
}

/**
 * Detailed view for one pair: creates the video object URL (if any) and parses
 * its SRT (if any), then hands both to the TelemetryPlayer for frame-synced
 * telemetry. Owns the object-URL lifecycle for this view, and offers to
 * complete a missing slot just like the gallery card.
 */
export default function DetailView({
  pair,
  onBack,
  onAttach,
  onDetach,
}: DetailViewProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);

  const { video, srt } = pair;

  // Lets the user convert an undecodable (often HEVC) clip to H.264 in-browser;
  // once ready, play that instead of the original.
  const transcode = useTranscode(video);
  const source = transcode.transcoded ?? video;

  useEffect(() => {
    if (!source) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(source);
    setVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setVideoUrl(null);
    };
  }, [source]);

  useEffect(() => {
    if (!srt) {
      setCues([]);
      return;
    }
    let cancelled = false;
    srt
      .text()
      .then((text) => {
        if (!cancelled) setCues(parseSrt(text));
      })
      .catch(() => {
        if (!cancelled) setCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [srt]);

  async function handleAdd(kind: 'video' | 'srt') {
    const file = await pickFile(kind === 'video' ? VIDEO_ACCEPT : SRT_ACCEPT);
    if (file) onAttach(pair, file);
  }

  const linkBtn =
    'p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline';
  // .notice base + .mismatch override (font-family: inherit, smaller text, line-strong border)
  const mismatchNotice =
    'm-0 px-[0.65rem] py-2 rounded-paper bg-accent-wash border border-line-strong text-accent-ink text-[0.76rem] leading-[1.45]';
  const notice =
    'my-4 px-4 py-[0.85rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.86rem] leading-[1.55]';

  return (
    <div>
      <button
        className="inline-flex items-center gap-[0.4rem] mb-5 font-mono text-[0.78rem] tracking-[0.04em] text-ink-soft cursor-pointer border-0 bg-transparent p-0 no-underline hover:text-accent"
        onClick={onBack}
      >
        ← Back to gallery
      </button>
      <h2 className="font-serif text-[clamp(1.6rem,4vw,2.4rem)] tracking-[-0.01em] normal-case text-ink m-0 mb-5 break-words">
        {video?.name ?? srt?.name ?? pair.baseName}
      </h2>

      {pair.videoNameMismatch && (
        <p className={mismatchNotice}>
          ⚠ Video name doesn’t match (
          <code className="font-mono text-ink break-all">{video?.name}</code> vs{' '}
          <code className="font-mono text-ink break-all">{pair.baseName}</code>).{' '}
          <button className={linkBtn} onClick={() => onDetach(pair, 'video')}>
            Remove
          </button>
        </p>
      )}
      {pair.srtNameMismatch && (
        <p className={mismatchNotice}>
          ⚠ Telemetry name doesn’t match (
          <code className="font-mono text-ink break-all">{srt?.name}</code> vs{' '}
          <code className="font-mono text-ink break-all">{pair.baseName}</code>).{' '}
          <button className={linkBtn} onClick={() => onDetach(pair, 'srt')}>
            Remove
          </button>
        </p>
      )}

      {!video && (
        <p className={notice}>
          No video for this telemetry yet.{' '}
          <button className={linkBtn} onClick={() => handleAdd('video')}>
            Add video
          </button>
        </p>
      )}
      {video && !srt && (
        <p className={notice}>
          No telemetry for this video yet.{' '}
          <button className={linkBtn} onClick={() => handleAdd('srt')}>
            Add telemetry (.srt)
          </button>
        </p>
      )}

      <TelemetryPlayer videoUrl={videoUrl} cues={cues} transcode={transcode} />
    </div>
  );
}
