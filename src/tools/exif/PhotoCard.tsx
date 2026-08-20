import { useEffect, useState } from 'react';
import { useInViewport } from '../../shared/lib/use-in-viewport';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { formatBytes } from '../../shared/lib/format';
import { imageTypeLabel } from '../../shared/media/image-meta';
import { cameraLine, exposureLine } from './exif-format';
import { isEmptyExif } from './exif-parser';
import { useExif } from './use-exif';
import type { Photo } from './photo';

interface PhotoCardProps {
  photo: Photo;
  index?: number;
  onOpen: (photo: Photo) => void;
}

export default function PhotoCard({ photo, index, onOpen }: PhotoCardProps) {
  const [ref, inView] = useInViewport<HTMLDivElement>();
  const [decodeError, setDecodeError] = useState(false);
  const exif = useExif(photo.image, inView);

  // Create the preview object URL only once visible; revoke on change/unmount.
  const url = useObjectUrl(inView ? photo.image : null);
  useEffect(() => {
    if (inView) setDecodeError(false);
  }, [inView, photo.image]);

  const camera = exif && cameraLine(exif);
  const exposure = exif && exposureLine(exif);
  const located = !!exif?.gps;
  const typeLabel = imageTypeLabel(photo.image.name);

  return (
    <div
      ref={ref}
      className="flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper-soft transition-[transform,box-shadow,border-color] duration-300 ease-paper hover:-translate-y-1 hover:shadow-paper hover:border-line-strong"
    >
      <div className="relative bg-frame leading-[0]">
        {index != null && (
          <span className="absolute top-[0.7rem] left-[0.7rem] z-[2] font-mono text-[0.64rem] tracking-[0.12em] px-2 py-[0.22rem] rounded-full bg-[rgba(20,18,15,0.55)] text-paper backdrop-blur-[4px] leading-[1.4]">
            NO. {String(index + 1).padStart(2, '0')}
          </span>
        )}
        {located && (
          <span
            className="absolute top-[0.7rem] right-[0.7rem] z-[2] inline-flex items-center gap-[0.4rem] font-mono text-[0.7rem] tracking-[0.02em] px-[0.6rem] py-[0.24rem] rounded-full bg-[rgba(20,18,15,0.55)] text-white backdrop-blur-[4px] leading-[1.4]"
            title="Geotagged"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            GPS
          </span>
        )}
        {url && !decodeError ? (
          <img
            src={url}
            alt={photo.baseName}
            className="block w-full aspect-[4/3] object-cover bg-frame"
            onError={() => setDecodeError(true)}
          />
        ) : (
          <div className="w-full aspect-[4/3] flex items-center justify-center bg-frame text-[#8c8576] text-[0.78rem] text-center p-4 font-mono leading-[1.5]">
            {decodeError
              ? `${typeLabel} — preview unavailable (browser can't decode it)`
              : '…'}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[0.7rem] flex-1 p-[1.1rem_1.2rem_1.2rem]">
        <h3
          className="m-0 text-base font-semibold tracking-[-0.01em] whitespace-nowrap overflow-hidden text-ellipsis"
          title={photo.baseName}
        >
          {photo.baseName}
        </h3>

        <p className="mt-[-0.3rem] mb-0 font-mono text-[0.74rem] tracking-[0.02em] text-muted flex items-center gap-2">
          {typeLabel}
          <span className="text-faint">·</span>
          {formatBytes(photo.image.size)}
        </p>

        {exif === undefined ? (
          <p className="m-0 text-[0.82rem] text-muted">Reading EXIF…</p>
        ) : isEmptyExif(exif) ? (
          <p className="m-0 text-[0.82rem] text-muted">No EXIF metadata.</p>
        ) : (
          <div className="flex flex-col gap-[0.3rem]">
            {camera && (
              <p className="m-0 text-[0.88rem] font-medium text-ink truncate" title={camera}>
                {camera}
              </p>
            )}
            {exposure && (
              <p className="m-0 font-mono text-[0.76rem] tabular-nums text-ink-soft">
                {exposure}
              </p>
            )}
          </div>
        )}

        <button
          className="mt-auto px-4 py-[0.7rem] inline-flex items-center justify-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.85rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent hover:text-white active:scale-[0.98]"
          onClick={() => onOpen(photo)}
        >
          View metadata
        </button>
      </div>
    </div>
  );
}
