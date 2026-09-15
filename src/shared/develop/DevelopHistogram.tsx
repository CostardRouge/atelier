import { clipLabel, histogramShape, type Histogram } from './histogram';

/**
 * The luminance strip over the sliders: where the picture's light sits, dark
 * to light, and — in words, at each end — how much has gone to black or to
 * white. The shape is scaled on its inner bins (`histogramShape`), so a sky
 * blown out does not flatten the rest; the clip marks are what say it.
 *
 * Drawn as one SVG area in the ink's own colour, so it reads on paper and in
 * the darkroom alike. Shared by the modal and the Develop tool.
 */
export default function DevelopHistogram({ histogram }: { histogram: Histogram | null }) {
  const heights = histogram ? histogramShape(histogram) : [];
  const n = heights.length;
  const path =
    n > 0
      ? `M0,1 ${heights.map((v, i) => `L${i / n},${1 - v} L${(i + 1) / n},${1 - v}`).join(' ')} L1,1 Z`
      : '';
  const blacks = histogram ? clipLabel(histogram.crushedShadows) : null;
  const whites = histogram ? clipLabel(histogram.clippedHighlights) : null;
  const described = histogram
    ? `Luminance histogram${blacks ? `, ${blacks} crushed to black` : ''}${whites ? `, ${whites} clipped to white` : ''}`
    : 'Luminance histogram, not read yet';

  return (
    <div className="flex flex-col gap-1" role="img" aria-label={described}>
      <div className="relative h-14 rounded-control bg-frame overflow-hidden">
        {n > 0 && (
          // The frame is dark in every theme, so the bars are the viewport's
          // own light rather than a theme token that turns dark in the darkroom.
          <div className="absolute inset-x-1.5 top-1.5 bottom-0">
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="block w-full h-full text-[rgba(251,248,241,0.62)]"
              aria-hidden="true"
            >
              <path d={path} fill="currentColor" />
            </svg>
          </div>
        )}
        {/* The clip marks: a bar at the end that has lost detail, lit only when it has. */}
        <span
          className={`absolute left-0 inset-y-0 w-1 ${blacks ? 'bg-info' : 'bg-transparent'}`}
          aria-hidden="true"
        />
        <span
          className={`absolute right-0 inset-y-0 w-1 ${whites ? 'bg-accent' : 'bg-transparent'}`}
          aria-hidden="true"
        />
      </div>
      <div className="flex justify-between font-mono text-3xs tabular-nums leading-none">
        <span className={blacks ? 'text-info' : 'text-faint'}>{blacks ? `blacks ${blacks}` : 'blacks —'}</span>
        <span className={whites ? 'text-accent-ink' : 'text-faint'}>{whites ? `whites ${whites}` : 'whites —'}</span>
      </div>
    </div>
  );
}
