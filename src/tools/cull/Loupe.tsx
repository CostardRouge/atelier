import { useEffect, useState } from 'react';
import type { Asset } from '../../shared/library/assets';
import type {
  Flag,
  MediaMeta,
  Verdict,
} from '../../shared/library/AssetLibraryContext';
import Stars from './Stars';

interface LoupeProps {
  asset: Asset | null;
  meta: MediaMeta | undefined;
  verdict: Verdict | undefined;
  onRate: (n: number) => void;
  onFlag: (flag: Flag) => void;
  className?: string;
}

/**
 * The large focused-asset view. Photos decode full-size (with a thumbnail /
 * type-label fallback for RAW the browser can't decode); videos show their
 * cover and mount a `<video>` only on click — triage is a fast scan, not
 * playback.
 */
export default function Loupe({
  asset,
  meta,
  verdict,
  onRate,
  onFlag,
  className,
}: LoupeProps) {
  const isPhoto = asset?.kind === 'photo';
  const file = asset?.parts.image ?? asset?.parts.video ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    setPlaying(false);
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
    // Keyed on identity, not the File object, to match the rest of the suite.
  }, [asset?.id]);

  const rating = verdict?.rating ?? 0;
  const flag = verdict?.flag ?? null;

  return (
    <div
      className={`relative rounded-paper overflow-hidden bg-frame flex items-center justify-center ${className ?? ''}`}
    >
      {!asset ? (
        <div className="text-muted font-mono text-[0.85rem] text-center p-6">
          Select photos or videos in the Library to start culling.
        </div>
      ) : isPhoto && url && !imgFailed ? (
        <img
          src={url}
          alt={asset.baseName}
          className="max-w-full max-h-full object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : !isPhoto && playing && url ? (
        <video
          src={url}
          controls
          autoPlay
          playsInline
          className="max-w-full max-h-full"
        />
      ) : meta?.thumbUrl ? (
        <button
          type="button"
          className="relative max-w-full max-h-full cursor-pointer"
          onClick={() => !isPhoto && setPlaying(true)}
          title={isPhoto ? asset.baseName : 'Play'}
        >
          <img
            src={meta.thumbUrl}
            alt={asset.baseName}
            className="max-w-full max-h-full object-contain"
          />
          {!isPhoto && (
            <span className="absolute inset-0 grid place-items-center text-white/90 text-4xl drop-shadow">
              ▶
            </span>
          )}
        </button>
      ) : (
        <div className="text-muted font-mono text-[0.8rem] text-center p-6">
          {isPhoto ? `${meta?.imageType ?? 'image'} · no preview` : '▶ no preview'}
        </div>
      )}

      {/* verdict controls */}
      {asset && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-3 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-sm">
          <Stars rating={rating} onRate={onRate} className="text-base" />
          <span className="w-px h-4 bg-white/25" />
          <button
            type="button"
            className={`text-[0.72rem] font-semibold px-2 py-0.5 rounded-full ${
              flag === 'pick' ? 'bg-[#3c7a3c] text-white' : 'text-white/80 hover:text-white'
            }`}
            onClick={() => onFlag(flag === 'pick' ? null : 'pick')}
            aria-pressed={flag === 'pick'}
            title="Pick (P)"
          >
            ✓ Pick
          </button>
          <button
            type="button"
            className={`text-[0.72rem] font-semibold px-2 py-0.5 rounded-full ${
              flag === 'reject' ? 'bg-accent text-white' : 'text-white/80 hover:text-white'
            }`}
            onClick={() => onFlag(flag === 'reject' ? null : 'reject')}
            aria-pressed={flag === 'reject'}
            title="Reject (X)"
          >
            ✕ Reject
          </button>
        </div>
      )}
    </div>
  );
}
