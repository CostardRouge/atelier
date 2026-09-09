import type { Anchor } from '../../../shared/overlay/overlay-types';
import StylePanel from '../../../shared/overlay/StylePanel';
import type { Shade } from '../../../shared/roadtrip/shades';
import type { BadgePieceStyle } from '../../../shared/roadtrip/badge-layout';
import type { BadgePiece } from '../../../shared/roadtrip/day-badge';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import type {
  PostBadge,
  PostSlide,
  TripDoc,
  TripPost,
} from '../../../shared/roadtrip/trip-types';
import SectionLegend from '../../../shared/ui/SectionLegend';
import PieceStylePanel from '../PieceStylePanel';
import ShadesPanel from '../ShadesPanel';
import { legend, linkButton } from './ui';

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

interface LookTabProps {
  trip: TripDoc;
  post: TripPost;
  /** The slide on the stage — a content slide's caption departs like a piece. */
  slide: DeckSlide;
  /** The badge only exists on the hook, and so do its placement and shades. */
  isHook: boolean;
  /** The piece in hand — chosen above the tabs, or by a click on the stage. */
  piece: BadgePiece;
  onChangeTrip: (trip: TripDoc) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  patchSlide: (patch: Partial<Pick<PostSlide, 'captionStyle'>>) => void;
  /** The trip's words live in its settings sheet now. */
  onOpenTripSettings: () => void;
}

/**
 * How the badge LOOKS: the trip's title style, this piece's departure from
 * it, where the block sits, how long the hook holds, and the shades that lift
 * the text off a bright sky.
 *
 * Two scopes, deliberately. The trip owns the title style — a badge that
 * varies per post stops being the signature that makes a post recognisable in
 * a feed — while one piece of one post may depart from that theme where a
 * particular picture needs it. The preset cards keep their own preview: a
 * style you cannot see before adopting is a style you adopt by trial.
 *
 * The trip's WORDS moved to the trip settings sheet; they are copy for every
 * piece of the journey, not a property of the one on the stage.
 */
export default function LookTab({
  trip,
  post,
  slide,
  isHook,
  piece,
  onChangeTrip,
  patchBadge,
  patchSlide,
  onOpenTripSettings,
}: LookTabProps) {
  const pieceStyle: BadgePieceStyle = post.badge.pieceStyles[piece] ?? {};
  const setPieceStyle = (style: BadgePieceStyle) =>
    patchBadge({ pieceStyles: { ...post.badge.pieceStyles, [piece]: style } });
  const setShades = (shades: Shade[]) => patchBadge({ shades });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <StylePanel
          theme={trip.theme}
          onChange={(theme) => onChangeTrip({ ...trip, theme })}
          heading={
            <span className="flex items-center gap-2">
              <SectionLegend label="Title style">
                <p>
                  The whole trip wears this — it is what makes a piece recognisable in a
                  feed before a word of it is read. Each card shows the style itself
                  rather than its name, so a look is chosen by seeing it.
                </p>
              </SectionLegend>
              <span className="font-mono text-[0.55rem] tracking-[0.12em] uppercase text-muted border border-line-strong rounded-full px-1.5 py-px">
                Trip
              </span>
            </span>
          }
        />
        <button type="button" onClick={onOpenTripSettings} className={`self-start ${linkButton}`}>
          The trip’s words and closing card…
        </button>
      </div>

      {isHook ? (
        <>
          <div className="flex flex-col gap-2">
            <SectionLegend label="This piece departs">
              <p>
                Colour, panel, casing and animation for the piece in hand only. A piece
                departs from the theme by writing its own value; everything left alone
                follows the trip.
              </p>
            </SectionLegend>
            <PieceStylePanel style={pieceStyle} onChange={setPieceStyle} />
          </div>

          <div className="flex flex-col gap-2">
            <SectionLegend label="Placement">
              <p>
                The grid is the coarse tool; drag the badge on the picture to place it
                exactly — hold Alt to skip the snap.
              </p>
            </SectionLegend>
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
            <SectionLegend label={`Hook duration · ${post.badge.durationSeconds.toFixed(1)}s`}>
              <p>How long the hook lasts — what an exit animation lands on.</p>
            </SectionLegend>
            <input
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={post.badge.durationSeconds}
              onChange={(e) => patchBadge({ durationSeconds: Number(e.target.value) })}
              className="accent-accent"
            />
          </label>

          <div className="flex flex-col gap-2">
            <SectionLegend label="Shades over the picture">
              <p>
                One stack of shades does both jobs — a vignette and the scrim under the
                badge. Each has a direction, a reach and a strength.
              </p>
            </SectionLegend>
            <ShadesPanel shades={post.badge.shades} onChange={setShades} />
          </div>
        </>
      ) : slide.kind === 'content' ? (
        <div className="flex flex-col gap-2">
          <SectionLegend label="This caption departs">
            <p>
              Colour, panel, casing and animation for this picture’s caption — the same
              model a badge piece uses, so a caption that slides in means what a piece
              sliding in does. Give it an animation and the slide becomes a video.
              Placement and shades stay with the badge on the hook.
            </p>
          </SectionLegend>
          <PieceStylePanel
            style={slide.captionStyle}
            onChange={(captionStyle) => patchSlide({ captionStyle })}
          />
        </div>
      ) : (
        <p className="m-0 text-[0.72rem] text-faint">
          The closing card keeps a fixed look; it is settled in the trip’s settings.
        </p>
      )}
    </div>
  );
}
