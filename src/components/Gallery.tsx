import type { MediaPair } from '../lib/pair-files';
import VideoCard from './VideoCard';

interface GalleryProps {
  pairs: MediaPair[];
  onOpen: (pair: MediaPair) => void;
}

/**
 * Grid of video cards. Each card lazily loads its own media as it scrolls into
 * view (see VideoCard's IntersectionObserver), so this renders instantly even
 * with many files.
 */
export default function Gallery({ pairs, onOpen }: GalleryProps) {
  if (pairs.length === 0) {
    return (
      <p className="notice">
        No videos found. Pick a folder containing DJI <code>.mp4</code>/
        <code>.mov</code> files (with their <code>.srt</code> siblings).
      </p>
    );
  }

  return (
    <div className="gallery">
      {pairs.map((pair) => (
        <VideoCard key={pair.baseName} pair={pair} onOpen={onOpen} />
      ))}
    </div>
  );
}
