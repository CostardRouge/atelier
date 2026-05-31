import { useRef, useState } from 'react';
import type { Cue } from '../lib/srt-parser';
import { useActiveCue } from '../hooks/use-active-cue';
import { TelemetryPanels } from './telemetry-view';

interface TelemetryPlayerProps {
  /** Object URL for the selected video, or null if none chosen. */
  videoUrl: string | null;
  /** Parsed telemetry cues (sorted by start), empty if no SRT loaded. */
  cues: Cue[];
}

export default function TelemetryPlayer({ videoUrl, cues }: TelemetryPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState(false);
  const cue = useActiveCue(videoRef, cues, videoUrl);

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
        <div className="placeholder">Select a video file to begin.</div>
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

      <TelemetryPanels cue={cue} />
    </div>
  );
}
