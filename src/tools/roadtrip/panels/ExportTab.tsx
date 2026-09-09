import { useMemo, useState } from 'react';
import SectionLegend from '../../../shared/ui/SectionLegend';
import type { OverlayElement } from '../../../shared/overlay/overlay-types';
import { useAvcEncodeSupport } from '../../../shared/media/use-encode-support';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import { describePlan, exportPlan } from '../../../shared/roadtrip/export-plan';
import type { TripDoc, TripGrade, TripPost } from '../../../shared/roadtrip/trip-types';
import StudioLink from '../StudioLink';
import type { GradeScope } from '../use-trip-grade';
import { reasonSentence } from './SlideDelivery';
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
  /** True when the Library holds a slide's picture — the plan needs to know. */
  hasPicture: (slide: DeckSlide) => boolean;
  /** A running export's progress line, or null when idle. */
  exporting: string | null;
  exportNote: string | null;
  onExportPiece: (opts: { imagesOnly: boolean; combine: boolean }) => void;
  onExportDeck: () => void;
  onExportHookClip: () => void;
  onChangePost: (post: TripPost) => void;
  /** The grade the piece wears here, and whose it is — the bridge says which grade a Studio export uses. */
  grade: TripGrade;
  gradeScope: GradeScope;
}

/**
 * What leaves the tool.
 *
 * The panel leads with the PLAN — one line per slide, its format and why —
 * because the deck already decided every format on the Content tab and this
 * is where the author checks it before pressing anything. Under it, the one
 * primary export, then the per-format escapes and the bridge that sends the
 * badge into a Studio project.
 *
 * All of it is about the PIECE, so all of it shows whichever slide is open.
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
  hasPicture,
  exporting,
  exportNote,
  onExportPiece,
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
  // Whether H.264 can really be encoded here, not merely whether the API
  // exists: a browser with the object and no codec would otherwise be told
  // "1 clip" and hit the platform's own error on the press.
  const canEncode = useAvcEncodeSupport();

  // The one override the export keeps. It is not a mode: it is what a browser
  // with no encoder can still do, and what a contact sheet of a reel is.
  const [imagesOnly, setImagesOnly] = useState(false);
  // The other delivery choice: the deck as ONE reel. Session state like the
  // override — how a piece is written today is not a property of the piece.
  const [combine, setCombine] = useState(false);
  const plan = useMemo(
    () => exportPlan(trip, post, { canEncode, hasPicture, imagesOnly, combine }),
    [trip, post, canEncode, hasPicture, imagesOnly, combine],
  );

  return (
    <div className="flex flex-col gap-4">
      {exportNote && <p className={note}>{exportNote}</p>}

      <div className={section}>
        <SectionLegend label={`What goes out · ${describePlan(plan)}`}>
          <p>
            Each slide leaves in the format it IS — decided on the Content tab, not
            here. Files are numbered in swipe order, so a deck mixing a clip and two
            photographs still uploads in the right one.
          </p>
        </SectionLegend>

        <ul className="m-0 p-0 list-none flex flex-col gap-1">
          {plan.items.map((item) => (
            <li
              key={`${item.kind}-${item.position}`}
              className="flex items-baseline gap-2 text-[0.74rem]"
            >
              <span className="flex-none font-mono text-[0.68rem] tabular-nums text-muted">
                {String(item.position).padStart(2, '0')}
              </span>
              <span
                className={`flex-1 min-w-0 truncate ${
                  item.blocker ? 'text-faint line-through' : 'text-ink'
                }`}
                title={item.name}
              >
                {item.name}
              </span>
              <span className="flex-none font-mono text-[0.62rem] tracking-[0.06em] uppercase text-muted">
                {/* Inside a reel every slide is on screen for its seconds,
                    a still included — that is what a held card is. */}
                {plan.reel || item.medium === 'video' ? `${item.seconds.toFixed(1)}s` : 'still'}
              </span>
            </li>
          ))}
        </ul>
        {/* Only while the reel CAN be written: beside a blocker, "written as
            one file" would contradict the legend one line above it. */}
        {plan.reel && plan.files > 0 && (
          <p className="m-0 text-[0.72rem] text-ink-soft">
            Written as one file, <span className="text-ink">{plan.reel.name}</span>: each
            slide for its own seconds, the hook playing its entrance. The reel is silent,
            and a clip slide is played by seeking its frames, which is slower than
            exporting that clip on its own.
          </p>
        )}

        {/* The hook's own reason, spelled out: it is the line an author
            changes most, and a word in a column does not explain itself. */}
        {plan.items[0] && (
          <p className="m-0 text-[0.72rem] text-muted">
            {reasonSentence(plan.items[0].reason, plan.items[0].seconds)}
          </p>
        )}

        {plan.blockers.map((b) => (
          <p key={b} className="m-0 text-[0.72rem] text-[#9a3a23]">
            {b}
          </p>
        ))}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => onExportPiece({ imagesOnly, combine })}
            disabled={exporting !== null || plan.files === 0}
            className="px-[1.1rem] py-1.5 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.8rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-60 disabled:cursor-default"
          >
            {/* Always "the piece": the file COUNT is what the legend says,
                and a deck of three whose two clips are blocked is still the
                piece being exported, not "this slide". */}
            {exporting ?? '↓ Export the piece'}
          </button>
          <label className="flex items-center gap-1.5 text-[0.74rem] text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={imagesOnly}
              onChange={(e) => setImagesOnly(e.target.checked)}
              className="accent-accent"
            />
            Everything as images
          </label>
          {slides.length > 1 && (
            <label
              className={`flex items-center gap-1.5 text-[0.74rem] cursor-pointer ${
                imagesOnly ? 'text-faint' : 'text-ink-soft'
              }`}
              title={
                imagesOnly
                  ? 'Images and a reel ask for opposite things; untick the other one first.'
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={combine && !imagesOnly}
                disabled={imagesOnly}
                onChange={(e) => setCombine(e.target.checked)}
                className="accent-accent"
              />
              Combine into one reel
            </label>
          )}
        </div>
      </div>

      <div className={section}>
        <span className={legend}>Or one format at a time</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExportDeck}
            disabled={exporting !== null}
            className={smallButton}
          >
            {slides.length === 1 ? '↓ The slide as a PNG' : `↓ All ${slides.length} slides as PNGs`}
          </button>
          {hookIsVideoSlide && (
            <button
              type="button"
              onClick={onExportHookClip}
              disabled={exporting !== null || !canEncode}
              className={smallButton}
            >
              ↓ The hook as a video · {hookLength.toFixed(1)}s
            </button>
          )}
        </div>
        <p className="m-0 text-[0.72rem] text-muted">
          {hookIsVideoSlide
            ? hookIsVideo
              ? 'The hook’s clip starts on the frame you chose, so the badge animates in on the first frame. Audio is copied through'
              : 'The hook is painted over its photograph, frame by frame, so its entrance plays. It comes out silent — there is no track to copy'
            : hookFile
              ? 'The hook goes out as an image: nothing on it moves. Give it an animation on the Look tab, or set the slide to Video to hold it as a card'
              : 'Give the hook a picture from the Library first'}
          {graded
            ? `, and every picture goes through ${gradeScope === 'post' ? 'this piece’s own' : 'the trip’s'} grade.`
            : '; nothing is graded — no grade is set.'}
        </p>
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
