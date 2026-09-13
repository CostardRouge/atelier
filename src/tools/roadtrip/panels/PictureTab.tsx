import { describeDevelop, type DevelopSettings } from '../../../shared/develop/develop';
import GradePanel from '../../../shared/lut/GradePanel';
import {
  DEFAULT_FRAMING,
  MAX_FRAMING_SCALE,
  isDefaultFraming,
  wrapDegrees,
  type Framing,
} from '../../../shared/media/framing';
import { ASPECT_PRESETS } from '../../../shared/projects/project-types';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import type { PostBadge, PostSlide, TripPost } from '../../../shared/roadtrip/trip-types';
import type { SlideRecovery } from '../use-slide-library';
import type { TripGradeBinding } from '../use-trip-grade';
import DayFromWinnow from '../DayFromWinnow';
import FrameStrip from '../FrameStrip';
import Button from '../../../shared/ui/Button';
import IconButton from '../../../shared/ui/IconButton';
import { FieldRow, InspectorSection, RangeField, Readout } from '../../../shared/ui/Inspector';
import { Icons } from '../../../shared/ui/icons';
import Segmented from '../../../shared/ui/Segmented';

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
  /** The grade, bound either to the trip or to this piece. */
  grade: TripGradeBinding;
  /** A reel from the linked project wears that project's grade, not this one. */
  linkedToProject: boolean;
  /** The open slide's own correction, or null for as shot. */
  develop: DevelopSettings | null;
  /** Open the Develop sheet over this slide's picture. */
  onOpenDevelop: () => void;
  /** Back to as shot. */
  onResetDevelop: () => void;
}

/** The two chips that say whose grade the stack is editing — the trip's, or this piece's own. */
export function GradeScopeChips({ grade }: { grade: TripGradeBinding }) {
  const { scope, setScope } = grade;
  return (
    <Segmented
      fill
      size="sm"
      className="flex-1 min-w-0"
      label="Grade scope"
      value={scope}
      onChange={setScope}
      options={[
        { id: 'trip', label: 'The trip’s' },
        { id: 'post', label: 'This piece’s own' },
      ]}
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
}: PictureTabProps) {
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';
  const { stack, scope } = grade;

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
                ) : !slideFile ? (
                  recovery?.state === 'fetching'
                    ? `It lives on ${recovery.sourceId} — fetching it back…`
                    : missing
                      ? 'Not in the Library right now. The slide keeps its place in the deck.'
                      : 'Tick a photo or a clip in the Library on the left.'
                ) : undefined
              }
            >
              <Readout muted={!slideFile}>{slideFile?.name ?? slide.media?.name ?? 'None'}</Readout>
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

      {!isCta && (
        <InspectorSection
          id="piece.framing"
          title="Framing"
          info={
            <>
              <p>
                Where the picture sits inside the frame. Drag it on the stage to move it,
                the wheel (or a trackpad pinch) to zoom; the badge keeps first claim on a
                press, so grab the picture where no text is.
              </p>
              <p>
                It can never be zoomed out past covering the frame or dragged off its edge
                — a deliverable with a gap in it is not one.
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
            isDefaultFraming(framing) ? undefined : (
              <Button size="sm" variant="ghost" onClick={() => onFraming({ ...DEFAULT_FRAMING })}>
                Reset
              </Button>
            )
          }
        >
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
        </InspectorSection>
      )}

      {/* The picture's own CORRECTION, one settled row: the sentence the
          sheet writes, the way in, and the way back to as shot. Per SLIDE,
          like the framing — about this photograph, never inherited. */}
      {!isCta && (
        <InspectorSection
          id="piece.develop"
          title="Develop"
          info={
            <p>
              This slide’s own correction — exposure, tone, colour — applied before the
              grade below. It belongs to this photograph and is never inherited by the
              next one.
            </p>
          }
        >
          <FieldRow label="Correction">
            <span
              className={`flex-1 min-w-0 truncate font-mono text-xs ${develop ? 'text-ink-soft' : 'text-muted'}`}
              title={describeDevelop(develop)}
            >
              {describeDevelop(develop)}
            </span>
            {develop && (
              <IconButton size="sm" variant="ghost" label="Back to as shot" onClick={onResetDevelop}>
                {Icons.reset}
              </IconButton>
            )}
            <Button
              size="sm"
              onClick={onOpenDevelop}
              disabled={!slideFile}
              title={slideFile ? 'Open the Develop sheet' : 'Tick a picture first'}
            >
              Develop…
            </Button>
          </FieldRow>
        </InspectorSection>
      )}

      <InspectorSection
        id="piece.format"
        title="Format"
        info={<p>The shape every slide of this deck is delivered in.</p>}
      >
        <FieldRow label="Frame">
          <Segmented
            fill
            size="sm"
            label="Format"
            value={post.badge.aspectId}
            onChange={(aspectId) => patchBadge({ aspectId })}
            options={ASPECT_PRESETS.map((a) => ({ id: a.id, label: a.id, title: a.label }))}
            className="flex-1 min-w-0"
          />
        </FieldRow>
      </InspectorSection>

      {/* The grade, through the Studio's own engine — one per piece, on every
          picture of the deck. */}
      <InspectorSection
        id="piece.grade"
        title="Grade"
        badge={scope === 'trip' ? 'Trip' : undefined}
        info={
          <>
            <p>
              {scope === 'trip'
                ? 'Every piece of the trip that has no grade of its own wears this one — the look that makes the feed read as one journey.'
                : 'A picture that needs its own correction. It started from the trip’s grade; “The trip’s” sends it back and drops this one.'}
            </p>
            <p>
              The preview, the PNG deck and the hook clip all grade through the Studio’s
              own shader. A different grade per slide is not offered yet.
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
