import { useEffect, useState } from 'react';
import type { MediaPair } from '../lib/pair-files';
import { parseSrt, type Cue } from '../lib/srt-parser';
import TelemetryPlayer from './TelemetryPlayer';

interface DetailViewProps {
  pair: MediaPair;
  onBack: () => void;
}

/**
 * Detailed view for one pair: creates the video object URL and parses its SRT,
 * then hands both to the (unchanged v1) TelemetryPlayer for frame-synced
 * telemetry. Owns the object-URL lifecycle for this view.
 */
export default function DetailView({ pair, onBack }: DetailViewProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);

  useEffect(() => {
    const url = URL.createObjectURL(pair.video);
    setVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setVideoUrl(null);
    };
  }, [pair.video]);

  useEffect(() => {
    if (!pair.srt) {
      setCues([]);
      return;
    }
    let cancelled = false;
    pair.srt
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
  }, [pair.srt]);

  return (
    <div>
      <button className="link-btn back" onClick={onBack}>
        ← Back to gallery
      </button>
      <h2 className="detail-title">{pair.video.name}</h2>
      <TelemetryPlayer videoUrl={videoUrl} cues={cues} />
    </div>
  );
}
