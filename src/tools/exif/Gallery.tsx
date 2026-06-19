import PhotoCard from './PhotoCard';
import type { Photo } from './photo';

interface GalleryProps {
  photos: Photo[];
  onOpen: (photo: Photo) => void;
}

/**
 * Grid of photo cards. Each card lazily reads its own preview and EXIF as it
 * scrolls into view (see PhotoCard's IntersectionObserver), so this renders
 * instantly even with a large shoot.
 */
export default function Gallery({ photos, onOpen }: GalleryProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
      {photos.map((photo, i) => (
        <PhotoCard key={photo.id} photo={photo} index={i} onOpen={onOpen} />
      ))}
    </div>
  );
}
