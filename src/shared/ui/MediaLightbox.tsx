import { useEffect, useState, type ReactNode } from 'react';
import useDialogKeys from './use-dialog-keys';
import StageZoomControl from './StageZoomControl';
import { DECK_GAP, DECK_SETTLE_MS, useMediaViewer, type MediaViewer } from './use-media-viewer';

/**
 * One media to look at, whatever holds it.
 *
 * The sheet never learns where the bytes come from: an instance hands it proxy
 * URLs, the Library hands it object URLs off the files on disk. That is the
 * whole point of the type — the gestures, the deck and the chrome are the
 * same thing in both places, and only the source and the footer differ.
 */
export interface LightboxItem {
  id: string;
  title: string;
  /** The one line of facts under the title. */
  facts: string;
  kind: 'photo' | 'video';
  /** What the middle slot draws. Null while it cannot be drawn. */
  src: string | null;
  /**
   * A still for the two slots beside the middle one, and a clip's poster. For
   * a picture it should be the SAME url as `src` — the browser then has it
   * cached and paging to it costs nothing.
   */
  still: string | null;
  /** The media's own pixel size, when the caller already knows it. */
  natural: { width: number; height: number } | null;
  /** Why there is nothing to draw — a RAW no browser decodes, say. */
  unavailable?: string | null;
  /**
   * Whether the URLs need the session cookie. An instance's proxies do; a
   * `blob:` off a local file is same-origin and must not be asked in CORS
   * mode at all.
   */
  credentialed?: boolean;
}

interface MediaLightboxProps {
  items: readonly LightboxItem[];
  /** Which one is open, an index into `items`. */
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** What the sheet is, for a screen reader: "…, from winnow.example". */
  from: string;
  /** The row under the deck — the one thing each caller does differently. */
  footer?: ReactNode;
  /** What Enter does, when the caller has one obvious action. */
  onConfirm?: (() => void) | null;
}

/**
 * A media, large, with hands: pinch or wheel to zoom, drag to pan, swipe to
 * the next one.
 *
 * A deck of three slots — previous · current · next — moved as one, so a swipe
 * reveals the neighbour progressively instead of cutting to it. Everything is
 * a transform and every limit is arithmetic we own (`use-media-viewer.ts`,
 * `pan-zoom.ts`); an editor stage's zoom is a different primitive on purpose,
 * because it can lean on a scroll box and a deck cannot.
 */
export default function MediaLightbox({
  items,
  index,
  onIndex,
  onClose,
  from,
  footer,
  onConfirm,
}: MediaLightboxProps) {
  const item = items[index] ?? null;

  // The caller usually knows the size already (an instance's row, the
  // library's measured meta), so the pan limits are right before a single
  // byte of the picture has arrived.
  const viewer = useMediaViewer({
    count: items.length,
    index,
    onIndex,
    natural: item?.natural ?? null,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') viewer.pageBy(-1);
      else if (e.key === 'ArrowRight') viewer.pageBy(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    // Whatever is behind a full-screen sheet still scrolls otherwise.
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = bodyOverflow;
    };
  }, [viewer.pageBy]);

  // Escape closes; Enter does the one thing the caller offers, if any.
  useDialogKeys({ onCancel: onClose, onConfirm: onConfirm ?? null });

  if (!item) return null;

  const arrow = (label: string, delta: -1 | 1, d: string) => (
    <button
      type="button"
      onClick={() => viewer.pageBy(delta)}
      disabled={items.length < 2}
      aria-label={label}
      title={`${label} (${delta < 0 ? '←' : '→'})`}
      className="flex-none self-center w-9 h-9 grid place-items-center rounded-full border border-line bg-surface text-ink-soft hover:text-accent hover:border-line-strong disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors max-[820px]:hidden"
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d={d}
        />
      </svg>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.title}, ${from}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[64rem] h-[min(90dvh,54rem)] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-4 overflow-hidden max-[820px]:max-w-none max-[820px]:h-dvh max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="m-0 font-serif text-[1.1rem] min-w-0 truncate" title={item.title}>
            {item.title}
          </h2>
          <span className="font-mono text-[0.62rem] text-muted whitespace-nowrap tabular-nums">
            {index + 1} / {items.length}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2.5 py-[3px] hover:text-accent hover:border-line-strong transition-colors"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>

        <p className="m-0 font-mono text-[0.64rem] text-muted truncate" title={item.facts}>
          {item.facts}
        </p>

        {/* The deck. Its slot is fixed by the panel, so paging never resizes
            the sheet, and it is what the gestures measure themselves against:
            `absolute inset-0` inside a `flex-1 min-h-0` wrapper, never a
            percentage height, which has nothing definite to resolve against
            in a flex column and left the picture cut by `overflow-hidden`. */}
        <div className="flex-1 min-h-0 flex items-stretch justify-center gap-3">
          {arrow('Previous', -1, 'M10 3.5 5.5 8 10 12.5')}
          <div className="relative flex-1 min-w-0 min-h-0 self-stretch">
            <div
              ref={viewer.viewportRef}
              // `touch-none`: the deck answers every touch itself, and a
              // native scroll or page zoom underneath would fight the pinch.
              className={`absolute inset-0 overflow-hidden bg-frame rounded-paper touch-none select-none ${
                viewer.zoomed ? (viewer.dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
              }`}
            >
              <div
                className="absolute inset-0"
                style={{
                  transform: `translate3d(${viewer.offset}px, 0, 0)`,
                  transition: viewer.settling
                    ? `transform ${DECK_SETTLE_MS}ms var(--ease-paper)`
                    : undefined,
                }}
              >
                {viewer.slots.map(({ slot, index: at }) => (
                  <div
                    // With three media or more each slot holds a different
                    // item, so keying by it lets React carry the neighbour's
                    // loaded picture into the middle: the page shows no
                    // reload. With two, both neighbours ARE the same item and
                    // the key has to be the slot instead.
                    key={items.length >= 3 ? items[at].id : slot}
                    className="absolute inset-0"
                    style={{
                      transform: `translateX(calc(${slot * 100}% + ${slot * DECK_GAP}px))`,
                    }}
                  >
                    <DeckSlide item={items[at]} active={slot === 0} viewer={viewer} />
                  </div>
                ))}
              </div>
            </div>
            <StageZoomControl
              zoom={viewer.zoom}
              hint="wheel, or pinch"
              className="absolute bottom-2 right-2 z-10"
            />
          </div>
          {arrow('Next', 1, 'M6 3.5 10.5 8 6 12.5')}
        </div>

        {footer}
      </div>
    </div>
  );
}

/**
 * One slot of the deck.
 *
 * Only the middle one is the media itself; the two beside it are the still —
 * for a picture the very URL the middle slot will want, so paging costs
 * nothing, for a clip its poster. A neighbour that mounted a `<video>` would
 * start decoding a second stream to be looked at for the length of a swipe.
 */
function DeckSlide({
  item,
  active,
  viewer,
}: {
  item: LightboxItem;
  active: boolean;
  viewer: MediaViewer;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [item.id]);

  const framed = {
    transform: active ? viewer.transform : undefined,
    // A finger is followed frame by frame; a button is animated.
    transition:
      active && viewer.viewSettling ? `transform ${DECK_SETTLE_MS}ms var(--ease-paper)` : undefined,
  };
  const fill = 'absolute inset-0 w-full h-full object-contain block';

  const still = active ? (item.src ?? item.still) : (item.still ?? item.src);

  if (item.unavailable || !still) {
    return (
      <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-[0.66rem] text-muted">
        {item.unavailable ?? 'nothing to show'}
      </span>
    );
  }

  if (item.kind === 'video' && active && item.src) {
    return (
      <video
        key={item.id}
        src={item.src}
        poster={item.still ?? undefined}
        crossOrigin={item.credentialed ? 'use-credentials' : undefined}
        controls
        // Metadata only: opening a day should not stream every clip.
        preload="metadata"
        style={framed}
        onLoadedMetadata={(e) =>
          viewer.onMeasured({
            width: e.currentTarget.videoWidth,
            height: e.currentTarget.videoHeight,
          })
        }
        className={fill}
      />
    );
  }

  return (
    <>
      <img
        key={item.id}
        src={still}
        alt={item.title}
        crossOrigin={item.credentialed ? 'use-credentials' : undefined}
        draggable={false}
        style={framed}
        onLoad={(e) => {
          setLoaded(true);
          if (active) {
            viewer.onMeasured({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            });
          }
        }}
        className={`${fill} transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {!loaded && active && (
        <span className="absolute inset-0 grid place-items-center font-mono text-[0.66rem] text-muted">
          loading…
        </span>
      )}
    </>
  );
}
