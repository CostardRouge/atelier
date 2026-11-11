import type { CSSProperties } from 'react';
import { networkOf, type NetworkId } from './networks';

/**
 * Each network's own colour, fixed: a mark is read by its colour before its
 * letters, in either theme (data, like a flag — never the suite's tokens).
 */
const PAINT: Record<NetworkId, CSSProperties> = {
  instagram: { background: 'conic-gradient(from 210deg, rgb(246,198,74), rgb(228,87,61), rgb(176,58,140), rgb(96,69,194), rgb(246,198,74))' },
  tiktok: { background: 'rgb(17,17,17)', boxShadow: 'inset 2px 0 0 rgb(37,244,238), inset -2px 0 0 rgb(254,44,85)' },
  youtube: { background: 'rgb(211,58,44)' },
  bluesky: { background: 'rgb(42,127,240)' },
  threads: { background: 'rgb(34,34,34)' },
  x: { background: 'rgb(0,0,0)', boxShadow: 'inset 0 0 0 1px rgb(90,90,90)' },
};
const UNKNOWN: CSSProperties = { background: 'rgb(120,112,98)' };

const SIZE = { xs: 'w-[18px] h-[18px]', sm: 'w-5 h-5', md: 'w-7 h-7' } as const;
/** The letters are the scale's smallest size, shrunk to the disc (the lint keeps arbitrary sizes out). */
const LETTERS = { xs: 'scale-[0.78]', sm: 'scale-[0.8]', md: '' } as const;

/**
 * A network's mark (lab 18): a disc in its colour with its two letters — what
 * the Where chips, the caption tabs and the gallery's stacked tiles show. With
 * a `picture`, the account's own face, the network as a small badge on it.
 */
export default function NetworkMark({ identifier, picture, size = 'md', className = '', title }: { identifier: string; picture?: string | null; size?: keyof typeof SIZE; className?: string; title?: string }) {
  const net = networkOf(identifier);
  const paint = net ? PAINT[net.id] : UNKNOWN;
  const mark = net?.mark ?? identifier.slice(0, 2);
  if (picture) {
    return (
      <span className={`relative flex-none inline-block ${SIZE[size]} ${className}`} title={title} aria-hidden={title ? undefined : true}>
        <img src={picture} alt="" className="w-full h-full rounded-full object-cover" />
        <span className="absolute -right-1 -bottom-1 w-3.5 h-3.5 rounded-full border-2 border-surface grid place-items-center font-mono font-semibold leading-none text-3xs text-on-media" style={paint}>
          <span className="scale-[0.62]">{mark}</span>
        </span>
      </span>
    );
  }
  return (
    <span className={`flex-none rounded-full grid place-items-center font-mono font-semibold leading-none text-3xs text-on-media ${SIZE[size]} ${className}`} style={paint} title={title} aria-hidden={title ? undefined : true}>
      <span className={LETTERS[size]}>{mark}</span>
    </span>
  );
}
