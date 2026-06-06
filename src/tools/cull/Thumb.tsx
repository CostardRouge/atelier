import { useEffect, useRef } from 'react';
import type { Asset } from '../../shared/library/assets';
import type { MediaMeta } from '../../shared/library/AssetLibraryContext';

interface ThumbProps {
  asset: Asset;
  meta: MediaMeta | undefined;
  onEnsure: () => void;
}

/** A read-only preview tile for the export set (lazy cover, no interaction). */
export default function Thumb({ asset, meta, onEnsure }: ThumbProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onEnsure();
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onEnsure]);

  const isPhoto = asset.kind === 'photo';
  return (
    <div
      ref={ref}
      title={asset.baseName}
      className="relative aspect-[3/2] overflow-hidden rounded-md bg-frame ring-1 ring-line/40 [content-visibility:auto] [contain-intrinsic-size:auto_88px]"
    >
      {meta?.thumbUrl ? (
        <img
          src={meta.thumbUrl}
          alt=""
          className="w-full h-full object-cover block"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center font-mono text-[0.55rem] text-[#8a8270] uppercase tracking-wide">
          {isPhoto ? (meta?.imageType ?? '◇') : '▶'}
        </span>
      )}
    </div>
  );
}
