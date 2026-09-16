import type { Anchor } from '../../../shared/overlay/overlay-types';
import StylePanel from '../../../shared/overlay/StylePanel';
import type { Shade } from '../../../shared/roadtrip/shades';
import { defaultCascade, type BadgePieceStyle } from '../../../shared/roadtrip/badge-layout';
import { STAGGER_ORDERS, newStaggerSeed } from '../../../shared/overlay/stagger';
import { StepRows } from '../PieceStylePanel';
import { SelectField, ToggleField } from '../../../shared/ui/Inspector';
import type { BadgePiece } from '../../../shared/roadtrip/day-badge';
import type { PostBadge, TripDoc, TripPost } from '../../../shared/roadtrip/trip-types';
import type { HookContext, HookPictureStatus } from '../../../shared/roadtrip/hooks/hook-variant';
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
  /** The badge only exists on the hook, and so does everything here but the theme. */
  isHook: boolean;
  /** What the piece's opener was prepared against — the picker hands it on. */
  hookCtx: HookContext;
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
  isHook,
  hookCtx,
  hookPictureStatus,
  piece,
  onChangeTrip,
  patchBadge,
  onOpenTripSettings,
  onConfigureCar,
}: LookTabProps) {
  const pieceStyle: BadgePieceStyle = post.badge.pieceStyles[piece] ?? {};
  const setPieceStyle = (style: BadgePieceStyle) =>
    patchBadge({ pieceStyles: { ...post.badge.pieceStyles, [piece]: style } });
  const setShades = (shades: Shade[]) => patchBadge({ shades });

  const departs = Object.keys(pieceStyle).length > 0;

  return (
    <div className="flex flex-col">
      {/* The opener comes FIRST: it decides what the hook IS, where the title
          style only decides how its words are set. */}
      {isHook && (
        <InspectorSection
          id="piece.opener"
          title="Opener"
          info={
            <p>
              What draws the first slide. The badge is the plain one — the counter and the
              place over the picture. Another variant may bring its own drawing, its own
              animation and its own sound, and says so on its card.
            </p>
          }
        >
          <HookPicker
            layers={post.badge.hook}
            ctx={hookCtx}
            pictureStatus={hookPictureStatus}
            onChange={(hook) => patchBadge({ hook })}
            onConfigureCar={onConfigureCar}
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
            <FieldRow label="Anchor" align="start">
              <div className="grid grid-cols-3 gap-1.5 w-[6.5rem]" role="group" aria-label="Anchor">
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
                    className={`h-7 rounded-[6px] border cursor-pointer transition-colors ${
                      anchor === post.badge.layout.anchor
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
                min={0.05}
                max={0.4}
                step={0.005}
                value={post.badge.layout.sizeFrac}
                onChange={(sizeFrac) => patchBadge({ layout: { ...post.badge.layout, sizeFrac } })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
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
              shades={post.badge.shades}
              onChange={setShades}
              anchor={post.badge.layout.anchor}
            />
          </InspectorSection>
        </>
      ) : (
        <InspectorSection id="piece.slide-look" title="This slide">
          <p className="m-0 text-xs text-muted">
            A caption and the closing card keep a fixed look; per-piece styling, placement
            and shades belong to the badge on the hook.
          </p>
        </InspectorSection>
      )}
    </div>
  );
}
