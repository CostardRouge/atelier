import { useMemo } from 'react';
import { tripTrace } from '../../shared/recap/recap-opener-trip';
import type { TripDoc } from '../../shared/roadtrip/trip-types';

type TripLike = Pick<TripDoc, 'name' | 'startDate' | 'endDate' | 'stages'>;

const W = 54;
const H = 36;

/**
 * A trip as a thumbnail (lab 16): the picture it shows of itself in Trips
 * when it has one, else its places traced on paper — a file never carries a
 * cover, and a road says which trip it is. No trip at all: an empty dashed
 * frame.
 */
export default function TripThumb({ trip, cover, className = '' }: { trip: TripLike | null; cover?: string | null; className?: string }) {
  const trace = useMemo(() => (trip && !cover ? tripTrace(trip, W, H, 5) : []), [trip, cover]);
  if (!trip) return <span className={`block aspect-[3/2] rounded-[6px] border border-dashed border-line-strong ${className}`} aria-hidden="true" />;
  return (
    <span className={`relative block aspect-[3/2] overflow-hidden rounded-[6px] border border-line bg-paper-2 ${className}`} aria-hidden="true">
      {cover ? (
        <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full text-accent">
          <path d={`M0 ${H / 3}h${W}M0 ${(2 * H) / 3}h${W}M${W / 3} 0v${H}M${(2 * W) / 3} 0v${H}`} className="stroke-line-strong" strokeWidth="0.4" fill="none" />
          {trace.length > 1 && <polyline points={trace.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />}
          {trace.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="1.3" className="fill-ink" />
          ))}
        </svg>
      )}
    </span>
  );
}
