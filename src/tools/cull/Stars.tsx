interface StarsProps {
  rating: number;
  /** When set, stars are clickable; clicking the current rating clears it. */
  onRate?: (n: number) => void;
  className?: string;
}

/** A 1–5 star strip; filled up to `rating`. Read-only unless `onRate` is given. */
export default function Stars({ rating, onRate, className }: StarsProps) {
  return (
    <div className={`inline-flex items-center gap-px ${className ?? ''}`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= rating;
        const star = (
          <span className={filled ? 'text-accent' : 'text-white/35'}>★</span>
        );
        if (!onRate) {
          return (
            <span key={n} aria-hidden="true">
              {star}
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            className="leading-none cursor-pointer hover:scale-110 transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              onRate(n === rating ? 0 : n);
            }}
            aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
            aria-pressed={filled}
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}
