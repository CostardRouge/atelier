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
      <p className="notice">
        Nothing found. Pick a folder, or add DJI <code>.mp4</code>/
        <code>.mov</code> videos and their <code>.srt</code> telemetry files.
      </p>
    );
  }

  return (
    <div className="gallery">
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
