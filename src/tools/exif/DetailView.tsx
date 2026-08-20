import { useEffect, useState } from 'react';
import { formatBytes } from '../../shared/lib/format';
import { imageTypeLabel } from '../../shared/media/image-meta';
import { ExifPanels } from './exif-view';
import { isEmptyExif, type ExifData } from './exif-parser';
import { useExif } from './use-exif';
import { useObjectUrl } from '../../shared/media/use-object-url';
import type { Photo } from './photo';

interface DetailViewProps {
  photo: Photo;
  onBack: () => void;
}

/**
 * Full view for one photo: a large preview plus the complete EXIF panels.
 * Owns the preview object-URL lifecycle. When the file carries no pixel
 * dimensions in EXIF (or none at all), the decoded image's natural size fills
 * that gap so the Image panel still reads.
 */
export default function DetailView({ photo, onBack }: DetailViewProps) {
  const url = useObjectUrl(photo.image);
  const [decodeError, setDecodeError] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const exif = useExif(photo.image, true);

  useEffect(() => {
    setDecodeError(false);
    setNatural(null);
  }, [photo.image]);

  const typeLabel = imageTypeLabel(photo.image.name);

  // Merge decoded dimensions in only where EXIF didn't supply them.
  const data: ExifData = {
    ...(exif ?? {}),
    pixelWidth: exif?.pixelWidth ?? natural?.w,
    pixelHeight: exif?.pixelHeight ?? natural?.h,
  };

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
      <h2 className="font-serif text-[clamp(1.6rem,4vw,2.4rem)] tracking-[-0.01em] normal-case text-ink m-0 mb-1 break-words">
        {photo.image.name}
      </h2>
      <p className="m-0 mb-5 font-mono text-[0.74rem] text-muted flex items-center gap-2">
        {typeLabel}
        <span className="text-faint">·</span>
        {formatBytes(photo.image.size)}
      </p>

      <div className="grid grid-cols-1 min-[820px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="rounded-paper-lg overflow-hidden bg-frame border border-line shadow-paper-soft grid place-items-center min-h-[200px]">
          {url && !decodeError ? (
            <img
              src={url}
              alt={photo.baseName}
              className="block w-full max-h-[70vh] object-contain"
              onLoad={(e) =>
                setNatural({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              onError={() => setDecodeError(true)}
            />
          ) : (
            <div className="p-8 text-center text-[#8c8576] font-mono text-[0.8rem] leading-[1.6]">
              {decodeError
                ? `${typeLabel} — this browser can't decode a preview. The metadata below is still read straight from the file.`
                : '…'}
            </div>
          )}
        </div>

        <div>
          {exif !== undefined && isEmptyExif(exif) && (
            <p className={notice}>
              No EXIF metadata found in this file. Dimensions (if shown) come
              from the decoded image.
            </p>
          )}
          <ExifPanels data={data} />
        </div>
      </div>
    </div>
  );
}
