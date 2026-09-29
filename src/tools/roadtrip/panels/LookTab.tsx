import type { Anchor } from '../../../shared/overlay/overlay-types';
import StylePanel from '../../../shared/overlay/StylePanel';
import type { Shade } from '../../../shared/roadtrip/shades';
import { defaultCascade, type BadgePieceStyle } from '../../../shared/roadtrip/badge-layout';
import { STAGGER_ORDERS, newStaggerSeed } from '../../../shared/overlay/stagger';
import { StepRows } from '../PieceStylePanel';
import { SelectField, ToggleField } from '../../../shared/ui/Inspector';
import type { BadgePiece } from '../../../shared/roadtrip/day-badge';
import type { PostBadge, TripDoc, TripPost } from '../../../shared/roadtrip/trip-types';
import type {
  HookContext,
  HookLayer,
  HookPictureStatus,
  HookShelf,
} from '../../../shared/roadtrip/hooks/hook-variant';
import type { BadgeLayout } from '../../../shared/roadtrip/badge-layout';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import {
  chapterMark,
  fullSlideBadge,
  isChapterMark,
  type SlideBadge,
} from '../../../shared/roadtrip/slide-capacities';
import Segmented from '../../../shared/ui/Segmented';
import HookPicker from './HookPicker';
import PieceStylePanel from '../PieceStylePanel';
import ShadesPanel from '../ShadesPanel';
import { linkButton } from './ui';
import Button from '../../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField } from '../../../shared/ui/Inspector';

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
  /**
   * The open slide. Its POSITION no longer decides what it may hold: any
   * slide but the closing card may carry an opener, a badge and shades. The
   * first slide's are the piece's own, and only there is the badge's LOOK —
   * its pieces' styles, its cascade — set, since every badge of the piece
   * wears it.
   */
  slide: DeckSlide;
  /** What the open slide's opener was prepared against — the picker hands it on. */
  hookCtx: HookContext;
  /**
   * The open slide's opener, what its other openers were given
   * (`PostBadge.hookShelf` on the first slide, its own elsewhere), and where
   * a choice is written — the shelf only when a switch changed it.
   */
  layers: readonly HookLayer[];
  shelf?: HookShelf;
  onLayers: (layers: HookLayer[], shelf?: HookShelf) => void;
  /** The open slide's shades, and where they are written. */
  shades: readonly Shade[];
  onShades: (shades: Shade[]) => void;
  /** Another slide's own badge: set, re-placed, or taken off with null. */
  onSlideBadge: (badge: SlideBadge | null) => void;
  /** How the opener's pictures are coming along — its panel says so. */
  hookPictureStatus?: HookPictureStatus;
  /** The piece in hand — chosen above the tabs, or by a click on the stage. */
  piece: BadgePiece;
  onChangeTrip: (trip: TripDoc) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  /** The trip's words live in its settings sheet now. */
  onOpenTripSettings: () => void;
  /** Opens the trip's garage, for the opener that drives its car. */
  onConfigureCar?: () => void;
  /** The shade whose centre the stage is placing, if any. */
  placingShade?: string | null;
  /** Hand a shade's centre to the stage, or take it back with null. */
  onPlaceShade?: (id: string | null) => void;
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
  hookCtx,
  layers,
  shelf,
  onLayers,
  shades,
  onShades,
  onSlideBadge,
  hookPictureStatus,
  piece,
  onChangeTrip,
  patchBadge,
  onOpenTripSettings,
  onConfigureCar,
  placingShade = null,
  onPlaceShade,
}: LookTabProps) {
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';
  const pieceStyle: BadgePieceStyle = post.badge.pieceStyles[piece] ?? {};
  const setPieceStyle = (style: BadgePieceStyle) =>
    patchBadge({ pieceStyles: { ...post.badge.pieceStyles, [piece]: style } });

  const departs = Object.keys(pieceStyle).length > 0;

  return (
    <div className="flex flex-col">
      {/* The opener comes FIRST: it decides what the slide IS, where the title
          style only decides how its words are set. Any slide may hold one — a
          second map for the day's next drive, a sweep to open a chapter. */}
      {!isCta && (
        <InspectorSection
          id="piece.opener"
          title="Opener"
          info={
            isHook ? (
              <p>
                What draws the first slide. The badge is the plain one — the counter and the
                place over the picture. Another variant may bring its own drawing, its own
                animation and its own sound, and says so on its card.
              </p>
            ) : (
              <p>
                What this slide opens with. Any slide may hold one: a second map for the
                day’s next drive, a sweep that opens a chapter. None draws the picture and
                whatever this slide says over it.
              </p>
            )
          }
        >
          <HookPicker
            layers={[...layers]}
            shelf={shelf}
            ctx={hookCtx}
            pictureStatus={hookPictureStatus}
            onChange={onLayers}
            onConfigureCar={onConfigureCar}
            slideOpener={!isHook}
          />
        </InspectorSection>
      )}

      <InspectorSection
        id="piece.title-style"
        title="Title style"
        badge="Trip"
        info={
          <p>
            The whole trip wears this — it is what makes a piece recognisable in a feed
            before a word of it is read. Each card shows the style itself rather than its
            name, so a look is chosen by seeing it.
          </p>
        }
      >
        <StylePanel
          theme={trip.theme}
          onChange={(theme) => onChangeTrip({ ...trip, theme })}
          heading={<></>}
        />
        <FieldRow label="Words">
          <button type="button" onClick={onOpenTripSettings} className={linkButton}>
            The trip’s words and closing card…
          </button>
        </FieldRow>
      </InspectorSection>

      {isHook ? (
        <>
          <InspectorSection
            id="piece.departs"
            title="This piece"
            info={
              <p>
                Colour, panel, casing and animation for the piece in hand only. A piece
                departs from the theme by writing its own value; everything left alone
                follows the trip.
              </p>
            }
            actions={
              departs ? (
                <Button size="sm" variant="ghost" onClick={() => setPieceStyle({})}>
                  Back to the trip’s
                </Button>
              ) : undefined
            }
          >
            <PieceStylePanel style={pieceStyle} onChange={setPieceStyle} />
          </InspectorSection>

          {/* One entrance for the whole badge, spread over the pieces by where
              they sit — instead of a delay typed on each. Exits stay per piece. */}
          <InspectorSection
            id="piece.cascade"
            title="Cascade"
            badge={post.badge.cascade ? 'on' : undefined}
            info={
              <>
                <p>
                  One entrance shared by every piece of the badge, the pieces arriving one
                  rank after another in the order chosen — top to bottom, the numeral
                  first, shuffled… The delays follow from where the pieces sit, so nothing
                  is typed per piece and nothing goes stale when the badge changes.
                </p>
                <p>
                  While it is on it replaces each piece’s own entrance; an exit a piece has
                  stays its own. A still is taken once the last piece has landed.
                </p>
              </>
            }
          >
            <FieldRow label="Cascade">
              <ToggleField
                label="Cascade the pieces"
                checked={Boolean(post.badge.cascade)}
                onChange={(on) => patchBadge({ cascade: on ? defaultCascade() : null })}
              />
            </FieldRow>
            {post.badge.cascade && (
              <>
                <StepRows
                  which="In"
                  step={post.badge.cascade.step}
                  hideDelay
                  onChange={(step) =>
                    patchBadge({
                      cascade: step
                        ? { ...post.badge.cascade!, step }
                        : { ...post.badge.cascade!, step: { preset: 'none', duration: 0, easing: 'linear' } },
                    })
                  }
                />
                <FieldRow label="Order">
                  <SelectField
                    label="Cascade order"
                    value={post.badge.cascade.stagger.order}
                    onChange={(order) =>
                      patchBadge({
                        cascade: {
                          ...post.badge.cascade!,
                          stagger: {
                            ...post.badge.cascade!.stagger,
                            order,
                            ...(order === 'random' && post.badge.cascade!.stagger.seed === undefined
                              ? { seed: newStaggerSeed() }
                              : {}),
                          },
                        },
                      })
                    }
                    options={STAGGER_ORDERS.map((o) => ({ id: o.id, label: `${o.label} — ${o.hint}` }))}
                  />
                </FieldRow>
                <FieldRow label="Each">
                  <RangeField
                    label="Seconds between two ranks"
                    min={0}
                    max={0.6}
                    step={0.01}
                    value={post.badge.cascade.stagger.each}
                    onChange={(each) =>
                      patchBadge({
                        cascade: { ...post.badge.cascade!, stagger: { ...post.badge.cascade!.stagger, each } },
                      })
                    }
                    format={(v) => `${v.toFixed(2)} s`}
                  />
                </FieldRow>
                {post.badge.cascade.stagger.order === 'random' && (
                  <FieldRow label="Shuffle">
                    <Button
                      size="sm"
                      onClick={() =>
                        patchBadge({
                          cascade: {
                            ...post.badge.cascade!,
                            stagger: { ...post.badge.cascade!.stagger, seed: newStaggerSeed() },
                          },
                        })
                      }
                    >
                      Shuffle again
                    </Button>
                  </FieldRow>
                )}
              </>
            )}
          </InspectorSection>

          <InspectorSection
            id="piece.placement"
            title="Placement"
            info={
              <p>
                The grid is the coarse tool; drag the badge on the picture to place it
                exactly — hold Alt to skip the snap.
              </p>
            }
          >
            <PlacementRows
              layout={post.badge.layout}
              onLayout={(layout) => patchBadge({ layout })}
              minSize={0.05}
            />
            <FieldRow label="Duration" hint="How long the hook lasts — what an exit animation lands on.">
              <RangeField
                label="Hook duration"
                min={1}
                max={15}
                step={0.5}
                value={post.badge.durationSeconds}
                onChange={(durationSeconds) => patchBadge({ durationSeconds })}
                format={(v) => `${v.toFixed(1)} s`}
              />
            </FieldRow>
          </InspectorSection>

          <InspectorSection
            id="piece.shades"
            title="Shades"
            info={
              <p>
                One stack of shades does both jobs — a vignette and the scrim under the
                badge. Each has a direction, a reach and a strength.
              </p>
            }
          >
            <ShadesPanel
              shades={[...shades]}
              onChange={onShades}
              anchor={post.badge.layout.anchor}
              placing={placingShade}
              onPlace={onPlaceShade}
            />
          </InspectorSection>
        </>
      ) : isCta ? (
        <InspectorSection id="piece.slide-look" title="This slide">
          <p className="m-0 text-xs text-muted">
            The closing card keeps a fixed look: it is the trip’s, edited once for every
            deck that closes with it.
          </p>
        </InspectorSection>
      ) : (
        <>
          <InspectorSection
            id="piece.slide-badge"
            title="Badge"
            badge={
              slide.badge ? (isChapterMark(slide.badge, post.badge) ? 'mark' : 'full') : undefined
            }
            info={
              <>
                <p>
                  A badge on this slide. A chapter mark is the piece’s badge at a third of
                  its size — a marker for the next leg, the next hour — so the first slide’s
                  badge stays the one dominant number of the piece.
                </p>
                <p>
                  Its look is the first slide’s: the pieces’ styles, the cascade and the
                  trip’s title style are set there, so every badge of the piece wears one
                  signature. What it says is set on the Content tab.
                </p>
              </>
            }
          >
            <FieldRow label="Badge">
              <Segmented
                label="Badge on this slide"
                size="sm"
                fill
                value={
                  slide.badge ? (isChapterMark(slide.badge, post.badge) ? 'mark' : 'full') : 'off'
                }
                onChange={(kind) =>
                  onSlideBadge(
                    kind === 'off'
                      ? null
                      : kind === 'mark'
                        ? chapterMark(post.badge)
                        : fullSlideBadge(post.badge),
                  )
                }
                options={[
                  { id: 'off', label: 'Off' },
                  { id: 'mark', label: 'Chapter mark' },
                  { id: 'full', label: 'Full', title: 'The piece’s own badge, at its own size' },
                ]}
              />
            </FieldRow>
            {slide.badge && (
              <>
                <PlacementRows
                  layout={slide.badge.layout}
                  onLayout={(layout) => onSlideBadge({ ...slide.badge!, layout })}
                  minSize={0.02}
                />
                <FieldRow label="Duration" hint="How long it lasts — what an exit animation lands on.">
                  <RangeField
                    label="Badge duration"
                    min={1}
                    max={15}
                    step={0.5}
                    value={slide.badge.durationSeconds}
                    onChange={(durationSeconds) => onSlideBadge({ ...slide.badge!, durationSeconds })}
                    format={(v) => `${v.toFixed(1)} s`}
                  />
                </FieldRow>
              </>
            )}
          </InspectorSection>

          <InspectorSection
            id="piece.shades"
            title="Shades"
            info={
              <p>
                This slide’s own stack of shades — a vignette, or a scrim to lift its words
                off a bright sky.
              </p>
            }
          >
            <ShadesPanel
              shades={[...shades]}
              onChange={onShades}
              anchor={slide.badge?.layout.anchor ?? 'bottom-left'}
              placing={placingShade}
              onPlace={onPlaceShade}
            />
          </InspectorSection>
        </>
      )}
    </div>
  );
}

/**
 * Where a badge sits and how big its numeral is — the piece's on the first
 * slide, a slide's own elsewhere. The grid is the coarse tool; a drag on the
 * picture places it exactly.
 */
function PlacementRows({
  layout,
  onLayout,
  minSize,
}: {
  layout: BadgeLayout;
  onLayout: (layout: BadgeLayout) => void;
  /** A chapter mark may be set far smaller than the piece's own numeral. */
  minSize: number;
}) {
  return (
    <>
      <FieldRow label="Anchor" align="start">
        <div className="grid grid-cols-3 gap-1.5 w-[6.5rem]" role="group" aria-label="Anchor">
          {ANCHORS.map((anchor) => (
            <button
              key={anchor}
              type="button"
              onClick={() => onLayout({ ...layout, anchor, ...positionFor(anchor) })}
              aria-label={anchor}
              aria-pressed={anchor === layout.anchor}
              className={`h-7 rounded-[6px] border cursor-pointer transition-colors ${
                anchor === layout.anchor
                  ? 'border-accent bg-accent'
                  : 'border-line-strong bg-paper hover:border-muted'
              }`}
            />
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Numeral">
        <RangeField
          label="Numeral size"
          min={minSize}
          max={0.4}
          step={0.005}
          value={layout.sizeFrac}
          onChange={(sizeFrac) => onLayout({ ...layout, sizeFrac })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </FieldRow>
    </>
  );
}
