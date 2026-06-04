import type { MediaPair } from './pair-files';
import VideoCard from './VideoCard';

interface GalleryProps {
  pairs: MediaPair[];
  onOpen: (pair: MediaPair) => void;
  onAttach: (pair: MediaPair, file: File) => void;
  onDetach: (pair: MediaPair, kind: 'video' | 'srt') => void;
}

/**
 * Grid of video cards. Each card lazily loads its own media as it scrolls into
 * view (see VideoCard's IntersectionObserver), so this renders instantly even
 * with many files.
 */
export default function Gallery({
  pairs,
  onOpen,
  onAttach,
  onDetach,
}: GalleryProps) {
  if (pairs.length === 0) {
    return (
      <p className="my-4 px-4 py-[0.85rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.86rem] leading-[1.55]">
        Nothing found. Pick a folder, or add DJI{' '}
        <code className="font-mono text-[0.85em] bg-[rgba(124,46,28,0.1)] px-[0.35em] py-[0.05em] rounded-[4px]">
          .mp4
        </code>
        /
        <code className="font-mono text-[0.85em] bg-[rgba(124,46,28,0.1)] px-[0.35em] py-[0.05em] rounded-[4px]">
          .mov
        </code>{' '}
        videos and their{' '}
        <code className="font-mono text-[0.85em] bg-[rgba(124,46,28,0.1)] px-[0.35em] py-[0.05em] rounded-[4px]">
          .srt
        </code>{' '}
        telemetry files.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
      {pairs.map((pair, i) => (
        <VideoCard
          key={pair.id}
          pair={pair}
          onOpen={onOpen}
          index={i}
          onAttach={onAttach}
          onDetach={onDetach}
        />
      ))}
    </div>
  );
}
