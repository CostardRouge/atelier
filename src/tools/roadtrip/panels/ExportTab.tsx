import type { OverlayElement } from '../../../shared/overlay/overlay-types';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import { MAX_HOOK_SECONDS, MIN_HOOK_SECONDS } from '../../../shared/roadtrip/hook-video';
import type { TripDoc, TripGrade, TripPost } from '../../../shared/roadtrip/trip-types';
import StudioLink from '../StudioLink';
import type { GradeScope } from '../use-trip-grade';
import { legend, note, section, smallButton } from './ui';

interface ExportTabProps {
  trip: TripDoc;
  post: TripPost;
  slides: DeckSlide[];
  /** The badge exactly as the stage draws it, for the Studio bridge. */
  hookElements: OverlayElement[];
  aspect: number;
  /** The hook's own picture, when the Library has it. */
  hookFile: File | null;
  hookIsVideo: boolean;
  /** The clip's length in seconds; 0 for a photo or while it loads. */
  duration: number;
  /** How long the burned-in hook clip runs, already clamped to the clip. */
  hookLength: number;
  onHookSeconds: (seconds: number) => void;
  /** A running export's progress line, or null when idle. */
  exporting: string | null;
  exportNote: string | null;
  onExportDeck: () => void;
  onExportHookClip: () => void;
  onChangePost: (post: TripPost) => void;
  /** The grade the piece wears here, and whose it is — the bridge says which grade a Studio export uses. */
  grade: TripGrade;
  gradeScope: GradeScope;
}

/**
 * What leaves the tool: the deck as PNGs, the hook burned into its clip, and
 * the bridge that sends the badge into a Studio project so one export carries
 * the grade, the telemetry and the hook. All of it is about the PIECE, so all
 * of it shows whichever slide is open.
 */
export default function ExportTab({
  trip,
  post,
  slides,
  hookElements,
  aspect,
  hookFile,
  hookIsVideo,
  duration,
  hookLength,
  onHookSeconds,
  exporting,
  exportNote,
  onExportDeck,
  onExportHookClip,
  onChangePost,
  grade,
  gradeScope,
}: ExportTabProps) {
  const graded = grade.layers.some((l) => l.enabled && l.intensity > 0);
  return (
    <div className="flex flex-col gap-4">
      {exportNote && <p className={note}>{exportNote}</p>}

      <div className={section}>
        <span className={legend}>
          PNG deck · {slides.length} slide{slides.length === 1 ? '' : 's'}
        </span>
        <p className="m-0 text-[0.74rem] text-muted">
          Every slide at 1920 on its long edge, named in swipe order. An animated badge
          is rendered settled, never mid-slide.
          {graded
            ? ` Every picture goes through ${gradeScope === 'post' ? 'this piece’s own' : 'the trip’s'} grade.`
            : ' The pictures go out as shot — no grade is set.'}
        </p>
        <button
          type="button"
          onClick={onExportDeck}
          disabled={exporting !== null}
          className={`self-start ${smallButton}`}
        >
          {exporting ?? (slides.length === 1 ? '↓ Export PNG' : `↓ Export ${slides.length} slides`)}
        </button>
      </div>

      <div className={section}>
        <span className={legend}>
          Hook clip{hookIsVideo && duration > 0 ? ` · ${hookLength.toFixed(1)}s` : ''}
        </span>
        {hookIsVideo && duration > 0 ? (
          <>
            <input
              type="range"
              min={MIN_HOOK_SECONDS}
              max={Math.min(MAX_HOOK_SECONDS, Math.max(MIN_HOOK_SECONDS, duration))}
              step={0.5}
              value={hookLength}
              onChange={(e) => onHookSeconds(Number(e.target.value))}
              className="accent-accent"
              aria-label="Hook clip length"
            />
            <p className="m-0 text-[0.72rem] text-muted">
              Starts on the hook’s frame, so the badge animates in on the first frame of
              the clip. Audio is copied through
              {graded ? ', and the clip is graded like the preview.' : '; the clip is not graded.'}
            </p>
            <button
              type="button"
              onClick={onExportHookClip}
              disabled={exporting !== null}
              className={`self-start ${smallButton}`}
            >
              ↓ Export hook video
            </button>
          </>
        ) : (
          <p className="m-0 text-[0.72rem] text-faint">
            {hookFile
              ? 'The hook sits on a photo; a clip is what gets the badge burned in.'
              : 'Give the hook a clip from the Library to burn the badge into it.'}
          </p>
        )}
      </div>

      <div className={section}>
        <span className={legend}>Studio · grade, telemetry, one export</span>
        <StudioLink
          post={post}
          elements={hookElements}
          shades={post.badge.shades}
          cta={trip.cta}
          aspect={aspect}
          file={hookFile}
          onChangePost={onChangePost}
          grade={grade}
          gradeScope={gradeScope}
        />
      </div>
    </div>
  );
}
