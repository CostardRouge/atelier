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
import SectionLegend from '../../../shared/ui/SectionLegend';
import type { SlideRecovery } from '../use-slide-library';
import type { TripGradeBinding } from '../use-trip-grade';
import DayFromWinnow from '../DayFromWinnow';
import FrameStrip from '../FrameStrip';
import { chipClass, legend, linkButton, smallButton } from './ui';

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
}: PictureTabProps) {
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';
  const { stack, scope, setScope } = grade;

  return (
    <div className="flex flex-col gap-4">
      {!isCta && (
        <div className="flex flex-col gap-2">
          <SectionLegend label="Picture">
            <p>
              This slide composes over whatever is ticked in the Library on the left,
              and picking another one there re-points the slide.
            </p>
          </SectionLegend>
          {slideFile ? (
            <p className="m-0 text-[0.8rem] text-ink-soft truncate" title={slideFile.name}>
              {slideFile.name}
            </p>
          ) : (
            <p className="m-0 text-[0.78rem] text-muted">
              {recovery?.state === 'fetching'
                ? `“${slide.media?.name}” lives on ${recovery.sourceId} — fetching it back…`
                : missing
                  ? `“${slide.media?.name}” is not in the Library right now. The slide keeps its place in the deck.`
                  : 'Tick a photo or a clip in the Library on the left — this slide composes over whatever is active there.'}
            </p>
          )}
          {recovery?.state === 'failed' && (
            <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
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

      {isCta && (
        <p className="m-0 text-[0.78rem] text-muted">
          The closing card carries no photograph: a flat ground is what keeps the QR
          readable and the sentence unmissable.
        </p>
      )}

      {!isCta && (
        <div className="flex flex-col gap-2">
          <SectionLegend label="Framing">
            <p>
              Where the picture sits inside the frame. Drag it on the stage to move it,
              the wheel (or a trackpad pinch) to zoom; the badge keeps first claim on a
              press, so grab the picture where no text is.
            </p>
            <p>
              It can never be zoomed out past covering the frame or dragged off its
              edge — a deliverable with a gap in it is not one.
            </p>
            {linkedToProject && (
              <p>
                A reel exported from the linked Studio project is framed there, over
                that project's own footage — this reframes the PNG deck and the hook
                clip.
              </p>
            )}
          </SectionLegend>
          <label className="flex flex-col gap-1">
            <span className={legend}>Zoom · {framing.scale.toFixed(2)}×</span>
            <input
              type="range"
              min={1}
              max={MAX_FRAMING_SCALE}
              step={0.01}
              value={framing.scale}
              onChange={(e) => onFraming({ ...framing, scale: Number(e.target.value) })}
              className="accent-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={legend}>Rotation · {Math.round(framing.rotation)}°</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={0.5}
              value={framing.rotation}
              onChange={(e) =>
                onFraming({ ...framing, rotation: Number(e.target.value) })
              }
              className="accent-accent"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                onFraming({ ...framing, rotation: wrapDegrees(framing.rotation - 90) })
              }
              title="Turn a quarter anticlockwise"
              className={smallButton}
            >
              ⟲ 90°
            </button>
            <button
              type="button"
              onClick={() =>
                onFraming({ ...framing, rotation: wrapDegrees(framing.rotation + 90) })
              }
              title="Turn a quarter clockwise"
              className={smallButton}
            >
              ⟳ 90°
            </button>
            <button
              type="button"
              onClick={() => onFraming({ ...framing, rotation: 0 })}
              disabled={framing.rotation === 0}
              className={`${smallButton} font-normal`}
            >
              Straight
            </button>
            <button
              type="button"
              onClick={() => onFraming({ ...DEFAULT_FRAMING })}
              disabled={isDefaultFraming(framing)}
              className={`ml-auto ${linkButton}`}
            >
              Reset the framing
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLegend label="Format">
          <p>The shape every slide of this deck is delivered in.</p>
        </SectionLegend>
        <div className="grid grid-cols-4 gap-1.5">
          {ASPECT_PRESETS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => patchBadge({ aspectId: a.id })}
              aria-pressed={a.id === post.badge.aspectId}
              title={a.label}
              className={chipClass(a.id === post.badge.aspectId)}
            >
              {a.id}
            </button>
          ))}
        </div>
      </div>

      {/* The grade, through the Studio's own engine — one per piece, on every
          picture of the deck. The closing card carries no photograph. */}
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2">
          <SectionLegend label="Grade">
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
          </SectionLegend>
          {scope === 'trip' && (
            <span className="font-mono text-[0.55rem] tracking-[0.12em] uppercase text-muted border border-line-strong rounded-full px-1.5 py-px">
              Trip
            </span>
          )}
        </span>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Grade scope">
          <button
            type="button"
            onClick={() => setScope('trip')}
            aria-pressed={scope === 'trip'}
            className={chipClass(scope === 'trip')}
          >
            The trip’s
          </button>
          <button
            type="button"
            onClick={() => setScope('post')}
            aria-pressed={scope === 'post'}
            className={chipClass(scope === 'post')}
          >
            This piece’s own
          </button>
        </div>
        <GradePanel stack={stack} />
        {stack.error && (
          <p className="m-0 text-[0.76rem] text-[#9a3a23]" role="alert">
            {stack.error}
          </p>
        )}
      </div>
    </div>
  );
}
