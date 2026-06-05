import { useEffect, useRef } from 'react';
import type { Asset } from '../../shared/library/assets';
import type { MediaMeta, Verdict } from '../../shared/library/AssetLibraryContext';
import Stars from './Stars';

interface CellProps {
  asset: Asset;
  meta: MediaMeta | undefined;
  verdict: Verdict | undefined;
  focused: boolean;
  onFocus: () => void;
  onEnsure: () => void;
}

/**
 * One triage tile. Kept deliberately light (a single IntersectionObserver, no
 * nested effects) so a grid of thousands stays cheap; `content-visibility:auto`
 * lets the browser skip rendering the ones off-screen.
 */
export default function Cell({
  asset,
  meta,
  verdict,
  focused,
  onFocus,
  onEnsure,
}: CellProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // Decode the cover only when the tile nears the viewport.
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
  const flag = verdict?.flag ?? null;
  const rating = verdict?.rating ?? 0;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onFocus}
      title={asset.baseName}
      className={`group relative block aspect-[3/2] overflow-hidden rounded-md bg-frame [content-visibility:auto] [contain-intrinsic-size:auto_88px] ${
        focused ? 'ring-2 ring-accent' : 'ring-1 ring-line/40'
      } ${flag === 'reject' ? 'opacity-50' : ''}`}
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

      {/* flag badge */}
      {flag && (
        <span
          className={`absolute top-1 right-1 w-4 h-4 grid place-items-center rounded-full text-[0.6rem] text-white ${
            flag === 'pick' ? 'bg-[#3c7a3c]' : 'bg-accent'
          }`}
          aria-hidden="true"
        >
          {flag === 'pick' ? '✓' : '✕'}
        </span>
      )}

      {/* rating, shown when set or on hover */}
      <span
        className={`absolute left-1 bottom-1 px-1 rounded bg-black/45 text-[0.6rem] ${
          rating > 0 ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <Stars rating={rating} />
      </span>
    </button>
  );
}
