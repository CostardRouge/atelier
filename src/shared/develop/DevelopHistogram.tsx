import { useSyncExternalStore } from 'react';
import { readoutLabel } from '../render/clipping';
import { channelShapes, clipLabel, type Histogram } from './histogram';
import type { ReadoutStore } from './readout-store';

/**
 * The picture's three channels as three areas, blended as light blends —
 * where all three overlap the strip goes to white, where one stands alone it
 * wears its own colour — so a red channel gone to 255 under a sky that still
 * reads as mid grey is seen, which a luminance strip hid (audit item 15).
 * Fixed colours on purpose: the frame is dark in every theme, and a channel
 * is its colour.
 */
const CHANNELS = [
  { key: 'red', fill: '#ff4a3d' },
  { key: 'green', fill: '#3fd46b' },
  { key: 'blue', fill: '#3f7dff' },
] as const;

function areaPath(heights: number[]): string {
  const n = heights.length;
  return n > 0 ? `M0,1 ${heights.map((v, i) => `L${i / n},${1 - v} L${(i + 1) / n},${1 - v}`).join(' ')} L1,1 Z` : '';
}

/** The pixel under the pointer — its own component, so a mouse move re-renders this line and nothing else. */
function ReadoutLine({ store }: { store: ReadoutStore }) {
  const at = useSyncExternalStore(store.subscribe, store.get);
  if (!at) return null;
  const clip = at.readout.kind === 'clip' ? at.readout.clip : null;
  return (
    <span
      className={`truncate ${clip === 'white' ? 'text-accent-ink' : clip === 'black' ? 'text-info' : 'text-muted'}`}
      aria-live="off"
    >
      {at.before ? 'before · ' : ''}
      {readoutLabel(at.readout)}
    </span>
  );
}

/**
 * The strip over the sliders: where the picture's light sits, dark to light,
 * per channel, and — in words, at each end — how much has gone to black or to
 * white. The shape is scaled on its inner bins (`channelShapes`), so a sky
 * blown out does not flatten the rest; the clip marks are what say it.
 *
 * Where the host can paint the clipping ON the picture (`onClipping`), the two
 * end words are that switch — Lightroom's triangles — and the J key its
 * shortcut; where it hands a `readout`, the pixel under the pointer is said
 * between them. Shared by the modal and the Develop tool.
 */
export default function DevelopHistogram({
  histogram,
  clipping = false,
  onClipping,
  readout,
}: {
  histogram: Histogram | null;
  /** The clipping view is on. */
  clipping?: boolean;
  /** Turn the clipping view on or off; absent where the host does not paint it. */
  onClipping?: () => void;
  /** The pixel under the pointer, where the host reads one. */
  readout?: ReadoutStore;
}) {
  const shapes = histogram && histogram.total > 0 ? channelShapes(histogram) : null;
  const blacks = histogram ? clipLabel(histogram.crushedShadows) : null;
  const whites = histogram ? clipLabel(histogram.clippedHighlights) : null;
  const described = histogram
    ? `RGB histogram${blacks ? `, ${blacks} crushed to black` : ''}${whites ? `, ${whites} clipped to white` : ''}`
    : 'RGB histogram, not read yet';

  const blackText = blacks ? `blacks ${blacks}` : 'blacks —';
  const whiteText = whites ? `whites ${whites}` : 'whites —';
  const endClass = (lit: boolean, tone: 'info' | 'accent') =>
    `${lit ? (tone === 'info' ? 'text-info' : 'text-accent-ink') : 'text-faint'} shrink-0`;
  const switchClass = `rounded-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
    clipping ? 'underline decoration-2' : ''
  }`;
  const switchTitle = clipping
    ? 'Hide the clipping on the picture (J)'
    : 'Show on the picture what has gone to white and to black (J)';

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-14 rounded-control bg-frame overflow-hidden" role="img" aria-label={described}>
        {shapes && (
          <div className="absolute inset-x-1.5 top-1.5 bottom-0">
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="block w-full h-full"
              style={{ isolation: 'isolate' }}
              aria-hidden="true"
            >
              {CHANNELS.map((c) => (
                <path
                  key={c.key}
                  d={areaPath(shapes[c.key])}
                  fill={c.fill}
                  fillOpacity={0.85}
                  style={{ mixBlendMode: 'screen' }}
                />
              ))}
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
      <div className="flex items-baseline justify-between gap-2 font-mono text-3xs tabular-nums leading-none min-w-0">
        {onClipping ? (
          <button
            type="button"
            className={`${endClass(Boolean(blacks), 'info')} ${switchClass}`}
            aria-pressed={clipping}
            title={switchTitle}
            onClick={onClipping}
          >
            {blackText}
          </button>
        ) : (
          <span className={endClass(Boolean(blacks), 'info')}>{blackText}</span>
        )}
        {readout && <ReadoutLine store={readout} />}
        {onClipping ? (
          <button
            type="button"
            className={`${endClass(Boolean(whites), 'accent')} ${switchClass}`}
            aria-pressed={clipping}
            title={switchTitle}
            onClick={onClipping}
          >
            {whiteText}
          </button>
        ) : (
          <span className={endClass(Boolean(whites), 'accent')}>{whiteText}</span>
        )}
      </div>
    </div>
  );
}
