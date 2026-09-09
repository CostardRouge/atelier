import type { OverlayElement } from '../../../shared/overlay/overlay-types';
import { isEncodeSupported } from '../../../shared/media/webcodecs-export';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
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
  /** True when the hook's picture is a clip — which SOURCE, not which medium. */
  hookIsVideo: boolean;
  /** How long the burned-in hook clip runs, already clamped to the clip. */
  hookLength: number;
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
  hookLength,
  exporting,
  exportNote,
  onExportDeck,
  onExportHookClip,
  onChangePost,
  grade,
  gradeScope,
}: ExportTabProps) {
  const graded = grade.layers.some((l) => l.enabled && l.intensity > 0);
  // What the HOOK SLIDE says it is, not what its file happens to be: a
  // photograph with an animated badge is a video now, and a clip the author
  // set to Image is not. The deck decides; this panel delivers.
  const hookIsVideoSlide = slides[0]?.medium === 'video';
  const canEncode = isEncodeSupported();
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
          Hook clip{hookIsVideoSlide ? ` · ${hookLength.toFixed(1)}s` : ''}
        </span>
        {hookIsVideoSlide ? (
          <>
            <p className="m-0 text-[0.72rem] text-muted">
              {hookIsVideo
                ? 'Starts on the hook’s frame, so the badge animates in on the first frame of the clip. Audio is copied through'
                : 'The badge is painted over the photograph, frame by frame, so its entrance plays. It comes out silent — there is no track to copy'}
              {graded ? ', and it is graded like the preview.' : '; it is not graded.'} How
              long it runs is the hook slide’s own screen time, set on the Content tab.
            </p>
            <button
              type="button"
              onClick={onExportHookClip}
              disabled={exporting !== null || !canEncode}
              className={`self-start ${smallButton}`}
            >
              ↓ Export hook video
            </button>
            {!canEncode && (
              <p className="m-0 text-[0.72rem] text-[#9a3a23]">
                This browser has no video encoder, so no clip can be written here. The
                slides still export as images.
              </p>
            )}
          </>
        ) : (
          <p className="m-0 text-[0.72rem] text-faint">
            {hookFile
              ? 'This hook goes out as an image. Nothing on it moves — give it an animation on the Look tab, or set the slide to Video on the Content tab to hold it as a card.'
              : 'Give the hook a picture from the Library first.'}
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
