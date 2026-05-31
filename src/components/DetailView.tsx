import { useEffect, useState } from 'react';
import type { MediaPair } from '../lib/pair-files';
import { parseSrt, type Cue } from '../lib/srt-parser';
import { pickFile, SRT_ACCEPT, VIDEO_ACCEPT } from '../sources/file-sources';
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

  useEffect(() => {
    if (!video) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setVideoUrl(null);
    };
  }, [video]);

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

  return (
    <div>
      <button className="link-btn back" onClick={onBack}>
        ← Back to gallery
      </button>
      <h2 className="detail-title">{video?.name ?? srt?.name ?? pair.baseName}</h2>

      {pair.videoNameMismatch && (
        <p className="notice mismatch">
          ⚠ Video name doesn’t match (<code>{video?.name}</code> vs{' '}
          <code>{pair.baseName}</code>).{' '}
          <button className="link-btn" onClick={() => onDetach(pair, 'video')}>
            Remove
          </button>
        </p>
      )}
      {pair.srtNameMismatch && (
        <p className="notice mismatch">
          ⚠ Telemetry name doesn’t match (<code>{srt?.name}</code> vs{' '}
          <code>{pair.baseName}</code>).{' '}
          <button className="link-btn" onClick={() => onDetach(pair, 'srt')}>
            Remove
          </button>
        </p>
      )}

      {!video && (
        <p className="notice">
          No video for this telemetry yet.{' '}
          <button className="link-btn" onClick={() => handleAdd('video')}>
            Add video
          </button>
        </p>
      )}
      {video && !srt && (
        <p className="notice">
          No telemetry for this video yet.{' '}
          <button className="link-btn" onClick={() => handleAdd('srt')}>
            Add telemetry (.srt)
          </button>
        </p>
      )}

      <TelemetryPlayer videoUrl={videoUrl} cues={cues} />
    </div>
  );
}
