import type { DevelopSettings } from '../../../shared/develop/develop';
import DevelopSection from '../../../shared/develop/DevelopSection';
import GradePanel from '../../../shared/lut/GradePanel';
import {
  DEFAULT_FRAMING,
  MAX_FRAMING_SCALE,
  flipFraming,
  isDefaultFraming,
  wrapDegrees,
  type Framing,
} from '../../../shared/media/framing';
import { ASPECT_PRESETS } from '../../../shared/projects/project-types';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import type { CollageLead, SlideCollage } from '../../../shared/roadtrip/collage';
import LayoutSection from './LayoutSection';
import CollageMotionSection from './CollageMotionSection';
import type { PostBadge, PostSlide, TripPost } from '../../../shared/roadtrip/trip-types';
import type { SlideRecovery } from '../use-slide-library';
import type { GradeScope, TripGradeBinding } from '../use-trip-grade';
import DayFromWinnow from '../DayFromWinnow';
import FrameStrip from '../FrameStrip';
import Button from '../../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, Readout } from '../../../shared/ui/Inspector';
import { Icons } from '../../../shared/ui/icons';
import Segmented, { type SegmentedOption } from '../../../shared/ui/Segmented';

/**
 * The formats from tallest to widest, so a shape sits beside its neighbours —
 * the preset list itself stays in portrait/landscape pairs for the Studio's
 * two-column cards.
 */
const FORMATS = [...ASPECT_PRESETS].sort((a, b) => a.w / a.h - b.w / b.h);

/** A format drawn as its own outline, 12px on its long side. */
function FormatGlyph({ w, h }: { w: number; h: number }) {
  const long = 12;
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-[1.5px] border-[1.5px] border-current"
      style={{
        width: w >= h ? long : Math.round((long * w) / h),
        height: w >= h ? Math.round((long * h) / w) : long,
      }}
    />
  );
}

interface PictureTabProps {
  post: TripPost;
  slide: DeckSlide;
  /** The picture the open slide composes over, when the Library has it. */
  slideFile: File | null;
  /** The slide names a picture the Library does not hold right now. */
  missing: boolean;
  /** What became of a picture being fetched back from its instance. */
  recovery: SlideRecovery | null;
  isVideo: boolean;
  /** The clip's length in seconds; 0 for a photo or while it loads. */
  duration: number;
  /**
   * A picture was taken from the day strip: its files, and the Library id
   * they build into so it becomes the active asset at once.
   */
  onPickFromSource: (files: File[], assetId: string) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  patchSlide: (patch: Partial<PostSlide>) => void;
  /** How the open slide's picture sits in the frame, and how to change it. */
  framing: Framing;
  onFraming: (framing: Framing) => void;
  /** The grade, bound to the trip, to this piece, or to this one picture. */
  grade: TripGradeBinding;
  /** A reel from the linked project wears that project's grade, not this one. */
  linkedToProject: boolean;
  /** The open slide's own correction, or null for as shot. */
  develop: DevelopSettings | null;
  /** Open the Develop sheet over this slide's picture. */
  onOpenDevelop: () => void;
  /** Back to as shot. */
  onResetDevelop: () => void;
  /** Several pictures in this slide's frame, or null for one. */
  collage: SlideCollage | null;
  /** The slide's own picture, framing and develop — the collage's first cell. */
  lead: CollageLead;
  /** The cell the framing and develop above are about; 0 is the slide's own. */
  selectedCell: number;
  onSelectCell: (i: number) => void;
  /** The Library's ticked picture. */
  activeFile: File | null;
  /** Every drawn cell's file, the lead first. */
  cellFiles: readonly (File | null)[];
  /** The selected cell's file — what the File row and the develop sheet are about. */
  cellFile: File | null;
  /** The collage's pictures still being fetched back, or that could not be, by asset id. */
  cellFetches: ReadonlyMap<string, SlideRecovery>;
  onChangeCollage: (collage: SlideCollage | null) => void;
  onUseActiveInCell: () => void;
  onClearCell: () => void;
}

/**
 * The three rungs a look can be written on, in order of reach.
 *
 * Three short words rather than the two sentences the old pair carried: at
 * 22rem, "This piece's own" and "This picture's own" side by side are two
 * ellipses. The titles say the whole thing.
 */
const GRADE_SCOPES: readonly SegmentedOption<GradeScope>[] = [
  {
    id: 'trip',
    label: 'Trip',
    title: 'The trip’s grade — worn by every piece that has none of its own',
  },
  {
    id: 'post',
    label: 'Piece',
    title: 'This piece’s own grade — every picture of the deck',
  },
  {
    id: 'slide',
    label: 'Picture',
    title: 'This one picture’s own grade — the rest of the deck is unchanged',
  },
];

/**
 * The chips that say WHOSE grade the stack is editing — the trip's, this
 * piece's, or this one picture's.
 *
 * The closing card cannot depart (it has no photograph), so its chip is not
 * drawn rather than drawn dead: an option that would do nothing is the
 * fabricated-example rule in its other half.
 */
export function GradeScopeChips({ grade }: { grade: TripGradeBinding }) {
  const { scope, setScope, canDepart } = grade;
  return (
    <Segmented
      fill
      size="sm"
      className="flex-1 min-w-0"
      label="Grade scope"
      value={scope}
      onChange={setScope}
      options={canDepart ? GRADE_SCOPES : GRADE_SCOPES.filter((o) => o.id !== 'slide')}
    />
  );
}

/**
 * WHICH picture, what shape it is delivered in, and how it is treated: the
 * file and the frame it opens on, the day's pictures asked of the instance
 * that holds them, the deck's aspect, and the grade.
 *
 * The grade sits here rather than on a tab of its own because it is the
 * picture that gets treated, not the typography — and because a tab holding
 * one scope switch and a LUT stack was a tab paying for itself in nothing.
 * Where the badge SITS and how it looks is the Look tab's business.
 *
 * The frame is a property of the PIECE (one deck, one shape) and shows on
 * every slide.
 */
export default function PictureTab({
  post,
  slide,
  slideFile,
  missing,
  recovery,
  isVideo,
  duration,
  onPickFromSource,
  patchBadge,
  patchSlide,
  framing,
  onFraming,
  grade,
  linkedToProject,
  develop,
  onOpenDevelop,
  onResetDevelop,
  collage,
  lead,
  selectedCell,
  onSelectCell,
  activeFile,
  cellFiles,
  cellFetches,
  cellFile,
  onChangeCollage,
  onUseActiveInCell,
  onClearCell,
}: PictureTabProps) {
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';
  const { stack, scope } = grade;
  /** The tag the per-cell sections wear when the inspector is about a later cell. */
  const cellBadge = collage && selectedCell > 0 ? `Cell ${selectedCell + 1}` : undefined;

  return (
    <div className="flex flex-col">
      <InspectorSection
        id="piece.picture"
        title="Picture"
        info={
          isCta ? undefined : (
            <p>
              This slide composes over whatever is ticked in the Library on the left, and
              picking another one there re-points the slide.
            </p>
          )
        }
      >
        {isCta ? (
          <p className="m-0 text-xs text-muted">
            The closing card carries no photograph: a flat ground is what keeps the QR
            readable and the sentence unmissable.
          </p>
        ) : (
          <>
            <FieldRow
              label="File"
              hint={
                recovery?.state === 'failed' ? (
                  <span className="text-danger" role="alert">
                    {recovery.problem}{' '}
                    {recovery.loginUrl && (
                      <a
                        className="font-semibold underline underline-offset-[3px]"
                        href={recovery.loginUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Sign in there
                      </a>
                    )}
                  </span>
                ) : !(collage ? cellFile : slideFile) ? (
                  recovery?.state === 'fetching'
                    ? `It lives on ${recovery.sourceId} — fetching it back…`
                    : missing
                      ? 'Not in the Library right now. The slide keeps its place in the deck.'
                      : 'Tick a photo or a clip in the Library on the left.'
                ) : undefined
              }
            >
              <Readout muted={!(collage ? cellFile : slideFile)}>
                {collage ? (cellFile?.name ?? 'None') : (slideFile?.name ?? slide.media?.name ?? 'None')}
              </Readout>
            </FieldRow>
            {/* The filmstrip moves the IN point and keeps the slide's length —
                it slides the whole stretch along the clip. The bar under the
                picture is where a cut is made, and where the speed is chosen. */}
            {isVideo && duration > 0 && slideFile && (
              <FieldRow
                label="In point"
                align="start"
                hint="Where the slide’s stretch of the clip starts; it keeps its length."
              >
                <div className="flex-1 min-w-0">
                  <FrameStrip
                    file={slideFile}
                    duration={duration}
                    value={slide.videoTimeSeconds}
                    label="In point"
                    onChange={(v) => {
                      if (isHook) patchBadge({ videoTimeSeconds: v });
                      else patchSlide({ videoTimeSeconds: v });
                    }}
                  />
                </div>
              </FieldRow>
            )}
          </>
        )}
      </InspectorSection>

      {/* The day this piece tells, asked of the instance that holds it — so
          the date is never picked by hand and one picture crosses at a time. */}
      {!isCta && (
        <DayFromWinnow
          day={post.date}
          onPicked={onPickFromSource}
          defaultOpen={!slideFile}
          busy={recovery?.state === 'fetching'}
        />
      )}

      {/* Several pictures in the frame. Above the framing because the framing
          and the develop below follow the cell selected here (or on the stage). */}
      {!isCta && (
        <LayoutSection
          collage={collage}
          lead={lead}
          selectedCell={selectedCell}
          onSelectCell={onSelectCell}
          activeFile={activeFile}
          cellFiles={cellFiles}
          cellFetches={cellFetches}
          onChange={onChangeCollage}
          onUseActive={onUseActiveInCell}
          onClearCell={onClearCell}
        />
      )}
      {!isCta && collage && (
        <CollageMotionSection collage={collage} seconds={slide.seconds} onChange={onChangeCollage} />
      )}

      {!isCta && (
        <InspectorSection
          id="piece.framing"
          title="Framing"
          badge={cellBadge}
          info={
            <>
              <p>
                Where the picture sits inside the frame. Drag it on the stage to move it,
                the wheel (or a trackpad pinch) to zoom; the badge keeps first claim on a
                press, so grab the picture where no text is.
              </p>
              <p>
                <strong>Fill</strong> covers the frame and crops what does not fit: it can
                never be zoomed out past covering or dragged off an edge.{' '}
                <strong>Whole</strong> shows all of the picture with black bars where it
                falls short of the frame; drag it to slide it along its bars.
              </p>
              <p>
                The flips mirror what the frame shows, whatever the picture’s rotation.
              </p>
              {linkedToProject && (
                <p>
                  A reel exported from the linked Studio project is framed there, over
                  that project's own footage — this reframes the PNG deck and the hook clip.
                </p>
              )}
            </>
          }
          actions={
            // Reset puts the picture back where it started INSIDE the fit
            // chosen: asking for the whole picture is not a crop to undo.
            isDefaultFraming({ ...framing, fit: 'cover' }) ? undefined : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onFraming({ ...DEFAULT_FRAMING, fit: framing.fit })}
              >
                Reset
              </Button>
            )
          }
        >
          <FieldRow label="Fit">
            <Segmented
              fill
              size="sm"
              label="Fit"
              value={framing.fit}
              // A new fit starts centred at its own scale 1: a zoom and a pan
              // chosen to crop mean something else once the bars are allowed.
              onChange={(fit) => {
                if (fit !== framing.fit) onFraming({ ...framing, fit, scale: 1, x: 0, y: 0 });
              }}
              options={[
                { id: 'cover', label: 'Fill', title: 'Cover the frame; the excess is cropped' },
                {
                  id: 'contain',
                  label: 'Whole',
                  title: 'Show the whole picture, with black bars where it falls short',
                },
              ]}
              className="flex-1 min-w-0"
            />
          </FieldRow>
          <FieldRow label="Zoom">
            <RangeField
              label="Zoom"
              min={1}
              max={MAX_FRAMING_SCALE}
              step={0.01}
              value={framing.scale}
              onChange={(scale) => onFraming({ ...framing, scale })}
              format={(v) => `${v.toFixed(2)}×`}
            />
          </FieldRow>
          <FieldRow label="Rotation">
            <RangeField
              label="Rotation"
              min={-180}
              max={180}
              step={0.5}
              value={framing.rotation}
              onChange={(rotation) => onFraming({ ...framing, rotation })}
              format={(v) => `${Math.round(v)}°`}
            />
          </FieldRow>
          <FieldRow label="Turn">
            <Button
              size="sm"
              onClick={() => onFraming({ ...framing, rotation: wrapDegrees(framing.rotation - 90) })}
              title="Turn a quarter anticlockwise"
            >
              −90°
            </Button>
            <Button
              size="sm"
              onClick={() => onFraming({ ...framing, rotation: wrapDegrees(framing.rotation + 90) })}
              title="Turn a quarter clockwise"
            >
              +90°
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onFraming({ ...framing, rotation: 0 })}
              disabled={framing.rotation === 0}
            >
              Straight
            </Button>
          </FieldRow>
          <FieldRow label="Flip">
            <Button
              size="sm"
              icon={Icons.flipHorizontal}
              onClick={() => onFraming(flipFraming(framing, 'x'))}
              title="Mirror the picture left to right"
            >
              Horizontal
            </Button>
            <Button
              size="sm"
              icon={Icons.flipVertical}
              onClick={() => onFraming(flipFraming(framing, 'y'))}
              title="Mirror the picture top to bottom"
            >
              Vertical
            </Button>
          </FieldRow>
        </InspectorSection>
      )}

      {/* The picture's own CORRECTION, one settled row: the sentence the
          sheet writes, the way in, and the way back to as shot. Per SLIDE,
          like the framing — about this photograph, never inherited. */}
      {!isCta && (
        <DevelopSection
          id="piece.develop"
          badge={cellBadge}
          info={
            <p>
              This slide’s own correction — exposure, tone, colour — applied before the
              grade below. It belongs to this photograph and is never inherited by the
              next one.
            </p>
          }
          develop={develop}
          canOpen={Boolean(collage ? cellFile : slideFile)}
          openTitle={(collage ? cellFile : slideFile) ? 'Open the Develop sheet' : 'Tick a picture first'}
          onOpen={onOpenDevelop}
          onReset={onResetDevelop}
        />
      )}

      <InspectorSection
        id="piece.format"
        title="Format"
        info={<p>The shape every slide of this deck is delivered in.</p>}
      >
        <FieldRow label="Frame">
          <Segmented
            columns={4}
            size="sm"
            label="Format"
            value={post.badge.aspectId}
            onChange={(aspectId) => patchBadge({ aspectId })}
            options={FORMATS.map((a) => ({
              id: a.id,
              label: a.id,
              title: a.label,
              icon: <FormatGlyph w={a.w} h={a.h} />,
            }))}
            className="flex-1 min-w-0"
          />
        </FieldRow>
      </InspectorSection>

      {/* The grade, through the Studio's own engine. Three rungs: the trip's
          look, a piece that departs from it, a picture that departs from the
          piece — a deck mixing a D-Log clip with a phone photograph cannot
          wear one conversion LUT. */}
      <InspectorSection
        id="piece.grade"
        title="Grade"
        badge={scope === 'trip' ? 'Trip' : scope === 'post' ? 'Piece' : undefined}
        info={
          <>
            <p>
              {scope === 'trip'
                ? 'Every piece of the trip that has no grade of its own wears this one — the look that makes the feed read as one journey.'
                : scope === 'post'
                  ? 'This piece’s own look, on every picture of its deck. It started from the trip’s; “Trip” sends it back and drops this one.'
                  : 'This one picture’s own look — for a slide that comes off another camera, or out of another profile, than the rest of the deck. It started from what the piece was wearing; “Piece” sends it back and drops this one.'}
            </p>
            <p>
              The preview, the rail, the PNG deck and the hook clip all grade through the
              Studio’s own shader, each picture through the grade it wears.
              {linkedToProject &&
                ' A reel exported from the linked Studio project uses that project’s grade, not this one — the Export tab says which.'}
            </p>
          </>
        }
      >
        <FieldRow label="Grade of">
          <GradeScopeChips grade={grade} />
        </FieldRow>
        <GradePanel stack={stack} />
        {stack.error && (
          <p className="m-0 text-xs text-danger" role="alert">
            {stack.error}
          </p>
        )}
      </InspectorSection>
    </div>
  );
}
