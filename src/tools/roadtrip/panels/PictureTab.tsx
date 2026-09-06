import type { Anchor } from '../../../shared/overlay/overlay-types';
import { ASPECT_PRESETS } from '../../../shared/projects/project-types';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import type { Shade } from '../../../shared/roadtrip/shades';
import type { PostBadge, PostSlide, TripPost } from '../../../shared/roadtrip/trip-types';
import FrameStrip from '../FrameStrip';
import ShadesPanel from '../ShadesPanel';
import { chipClass, legend, section } from './ui';

/** The nine anchors, laid out as the 3×3 grid they are. */
const ANCHORS: Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** Where an anchor's default position sits, so picking one actually moves it. */
export function positionFor(anchor: Anchor): { x: number; y: number } {
  const x = anchor.endsWith('-left') ? 0.07 : anchor.endsWith('-right') ? 0.93 : 0.5;
  const y = anchor.startsWith('top-') ? 0.08 : anchor.startsWith('bottom-') ? 0.92 : 0.5;
  return { x, y };
}

interface PictureTabProps {
  post: TripPost;
  slide: DeckSlide;
  /** The picture the open slide composes over, when the Library has it. */
  slideFile: File | null;
  /** The slide names a picture the Library does not hold right now. */
  missing: boolean;
  isVideo: boolean;
  /** The clip's length in seconds; 0 for a photo or while it loads. */
  duration: number;
  patchBadge: (patch: Partial<PostBadge>) => void;
  patchSlide: (patch: Partial<PostSlide>) => void;
}

/**
 * The picture and what sits on it: which file and which frame, the frame's
 * shape, where the badge block lands and how big its numeral is, the shades
 * that lift the text off a bright sky, and how long the hook holds.
 *
 * The frame is a property of the PIECE (one deck, one shape) and shows on
 * every slide; the placement, the shades and the duration are the badge's
 * and show on the hook only.
 */
export default function PictureTab({
  post,
  slide,
  slideFile,
  missing,
  isVideo,
  duration,
  patchBadge,
  patchSlide,
}: PictureTabProps) {
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';
  const setShades = (shades: Shade[]) => patchBadge({ shades });

  return (
    <div className="flex flex-col gap-4">
      {!isCta && (
        <div className={section}>
          <span className={legend}>Picture · from the Library</span>
          {slideFile ? (
            <p className="m-0 text-[0.8rem] text-ink-soft truncate" title={slideFile.name}>
              {slideFile.name}
            </p>
          ) : (
            <p className="m-0 text-[0.78rem] text-muted">
              {missing
                ? `“${slide.media?.name}” is not in the Library right now. The slide keeps its place in the deck.`
                : 'Tick a photo or a clip in the Library on the left — this slide composes over whatever is active there.'}
            </p>
          )}
          {isVideo && duration > 0 && slideFile && (
            <FrameStrip
              file={slideFile}
              duration={duration}
              value={slide.videoTimeSeconds}
              onChange={(v) => {
                if (isHook) patchBadge({ videoTimeSeconds: v });
                else patchSlide({ videoTimeSeconds: v });
              }}
            />
          )}
        </div>
      )}

      {isCta && (
        <p className="m-0 text-[0.78rem] text-muted">
          The closing card carries no photograph: a flat ground is what keeps the QR
          readable and the sentence unmissable.
        </p>
      )}

      <div className={section}>
        <span className={legend}>Frame · the whole deck</span>
        <div className="grid grid-cols-4 gap-1.5">
          {ASPECT_PRESETS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => patchBadge({ aspectId: a.id })}
              aria-pressed={a.id === post.badge.aspectId}
              className={chipClass(a.id === post.badge.aspectId)}
            >
              {a.id}
            </button>
          ))}
        </div>
      </div>

      {isHook && (
        <>
          <div className={section}>
            <span className={legend}>Placement</span>
            <div className="flex items-start gap-3">
              <div
                className="grid grid-cols-3 gap-1.5 w-[6.5rem] flex-none"
                role="group"
                aria-label="Anchor"
              >
                {ANCHORS.map((anchor) => (
                  <button
                    key={anchor}
                    type="button"
                    onClick={() =>
                      patchBadge({
                        layout: { ...post.badge.layout, anchor, ...positionFor(anchor) },
                      })
                    }
                    aria-label={anchor}
                    aria-pressed={anchor === post.badge.layout.anchor}
                    className={`h-7 rounded-[4px] border cursor-pointer transition-colors ${
                      anchor === post.badge.layout.anchor
                        ? 'border-accent bg-accent'
                        : 'border-line bg-paper hover:border-line-strong'
                    }`}
                  />
                ))}
              </div>
              <label className="flex-1 flex flex-col gap-1">
                <span className={legend}>
                  Numeral · {Math.round(post.badge.layout.sizeFrac * 100)}%
                </span>
                <input
                  type="range"
                  min={0.05}
                  max={0.4}
                  step={0.005}
                  value={post.badge.layout.sizeFrac}
                  onChange={(e) =>
                    patchBadge({
                      layout: { ...post.badge.layout, sizeFrac: Number(e.target.value) },
                    })
                  }
                  className="accent-accent"
                />
              </label>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className={legend}>
              Hook duration · {post.badge.durationSeconds.toFixed(1)}s
            </span>
            <input
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={post.badge.durationSeconds}
              onChange={(e) => patchBadge({ durationSeconds: Number(e.target.value) })}
              className="accent-accent"
            />
            <span className="text-[0.68rem] text-faint">
              How long the hook lasts — what an exit animation lands on.
            </span>
          </label>

          <div className={section}>
            <span className={legend}>Shades over the picture</span>
            <ShadesPanel shades={post.badge.shades} onChange={setShades} />
          </div>
        </>
      )}
    </div>
  );
}
