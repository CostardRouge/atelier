import { useEffect, useRef, useState } from 'react';
import type { Cue } from './srt-parser';
import { useActiveCue } from './use-active-cue';
import { TelemetryPanels } from './telemetry-view';
import type { UseTranscode } from '../../shared/media/use-transcode';
import TranscodeControl from '../../shared/media/TranscodeControl';

interface TelemetryPlayerProps {
  /** Object URL for the selected video, or null if none chosen. */
  videoUrl: string | null;
  /** Parsed telemetry cues (sorted by start), empty if no SRT loaded. */
  cues: Cue[];
  /** In-browser HEVC→H.264 transcode state for the source clip. */
  transcode: UseTranscode;
}

export default function TelemetryPlayer({
  videoUrl,
  cues,
  transcode,
}: TelemetryPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState(false);
  const cue = useActiveCue(videoRef, cues, videoUrl);

  // Clear a prior decode error when the source changes (e.g. after a transcode
  // swaps in the H.264 file), so the notice doesn't linger over a clip that
  // now plays.
  useEffect(() => setVideoError(false), [videoUrl]);

  return (
    <div>
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          onError={() => setVideoError(true)}
          className="block w-full max-h-[64vh] bg-frame rounded-paper"
        />
      ) : (
        <div className="w-full aspect-video flex items-center justify-center bg-surface border border-line rounded-paper text-muted text-center p-4 font-mono text-[0.85rem]">
          Select a video file to begin.
        </div>
      )}

      {videoError && (
        <div className="my-4 px-4 py-[0.85rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.86rem] leading-[1.55] flex flex-col gap-3">
          <p className="m-0">
            The video failed to play. DJI clips are often HEVC/H.265, which not
            every browser decodes natively. The telemetry below still works if
            the SRT loaded. Transcode the clip to H.264 to play it here (or try
            Safari, which decodes HEVC best).
          </p>
          <TranscodeControl state={transcode} />
        </div>
      )}

      {videoUrl && cues.length === 0 && (
        <p className="my-4 px-4 py-[0.85rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.86rem] leading-[1.55]">
          No telemetry loaded yet — select the matching{' '}
          <code className="font-mono text-[0.85em] bg-[rgba(124,46,28,0.1)] px-[0.35em] py-[0.05em] rounded-[4px]">
            .srt
          </code>{' '}
          file.
        </p>
      )}

      <TelemetryPanels cue={cue} />
    </div>
  );
}
