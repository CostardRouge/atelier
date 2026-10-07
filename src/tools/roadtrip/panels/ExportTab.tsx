import type { OverlayElement } from '../../../shared/overlay/overlay-types';
import TranscodeControl from '../../../shared/media/TranscodeControl';
import { useTranscode } from '../../../shared/media/use-transcode';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import { describePlan, type PieceExportPlan } from '../../../shared/roadtrip/export-plan';
import type { TripDoc, TripGrade, TripPost } from '../../../shared/roadtrip/trip-types';
import type { HookBlock } from '../../../shared/shades/shades';
import StudioLink from '../StudioLink';
import type { GradeScope } from '../use-trip-grade';
import { reasonSentence } from './SlideDelivery';
import { note } from './ui';
import type { DeliverySummary } from '../../../shared/develop/roll-export';
import { FieldRow, InspectorSection, LockSections } from '../../../shared/ui/Inspector';
import RunLockNotice from '../../../shared/ui/RunLockNotice';

interface ExportTabProps {
  trip: TripDoc;
  post: TripPost;
  slides: DeckSlide[];
  /** The badge exactly as the stage draws it, for the Studio bridge. */
  hookElements: OverlayElement[];
  /** The hook badge's block — what a shade following it lands on. */
  hookBlock: HookBlock | null;
  aspect: number;
  /** The hook's own picture, when the Library has it. */
  hookFile: File | null;
  /** True when the hook's picture is a clip — which SOURCE, not which medium. */
  hookIsVideo: boolean;
  /** How long the first slide is on screen — what the badge's exit lands on, sent with the scene. */
  hookSeconds: number;
  /**
   * What the piece's primary export will write, slide by slide — computed by
   * the editor, which also draws the pinned bar that presses it.
   */
  plan: PieceExportPlan;
  /** A clip the last export could not decode here; the transcode is offered for it. */
  undecodable: File | null;
  /**
   * What the OPEN picture would deliver into the deck's frame, or null when
   * nothing is measured. Said, never chosen: a picture from an instance
   * leaves from its full-size original only where its proxy could not fill
   * the frame (R5 of `docs/capture-renditions.md`), and there is no door
   * here to force or refuse that.
   */
  delivery: DeliverySummary | null;
  onChangePost: (post: TripPost) => void;
  /**
   * The grade the HOOK wears here, and whose it is — the bridge says which
   * grade a Studio export uses.
   */
  grade: TripGrade;
  gradeScope: GradeScope;
  /**
   * How many pictures of the deck carry a look of their own. The plan may not
   * claim one grade for the whole deck when they do — the same
   * anti-fabrication rule every mode in this tool follows.
   */
  ownGrades: number;
  /** When the running export took the piece — its sections are locked (L2) — or null when idle. */
  lockedSince?: number | null;
}

/**
 * What leaves the tool.
 *
 * The panel leads with the PLAN — one line per slide, its format and why —
 * because the deck already decided every format on the Content tab and this
 * is where the author checks it before pressing anything. The verbs are not
 * here (2026-09-29, Develop's grammar): they are pinned under the tab's scroll
 * (`DeliverBar`, drawn by the editor), the primary one and a menu holding
 * every slide as a still, the open slide as a PNG and the hook as a video —
 * what used to be a switch the header's Export never read, and a section of
 * its own. What stays is what is SET, and the bridge to a Studio project.
 *
 * All of it is about the PIECE, so all of it shows whichever slide is open.
 */
export default function ExportTab({
  trip,
  post,
  slides,
  hookElements,
  hookBlock,
  aspect,
  hookFile,
  hookIsVideo,
  hookSeconds,
  plan,
  undecodable,
  delivery,
  onChangePost,
  grade,
  gradeScope,
  ownGrades,
  lockedSince = null,
}: ExportTabProps) {
  const graded = grade.layers.some((l) => l.enabled && l.intensity > 0);
  // The in-browser transcode for a clip this browser cannot decode — the
  // Studio's own control, shared through the file-keyed store, so a clip
  // transcoded here is the one every export reads from then on.
  const transcode = useTranscode(undecodable);
  // What the HOOK SLIDE says it is, not what its file happens to be: a
  // photograph with an animated badge is a video now, and a clip the author
  // set to Image is not. The deck decides; this panel delivers.
  const hookIsVideoSlide = slides[0]?.medium === 'video';

  return (
    <div className="flex flex-col">
      {lockedSince !== null && (
        <RunLockNotice since={lockedSince}>
          Retouching stays free; a slide edited now is named when the run ends, and the deck’s order waits for it.
        </RunLockNotice>
      )}
      <LockSections locked={lockedSince !== null}>
        <InspectorSection
          id="piece.export.plan"
          title="What goes out"
          badge={describePlan(plan)}
          info={
            <>
              <p>
                Each slide leaves in the format it IS — decided on the Content tab, not here.
                Files are numbered in swipe order, so a deck mixing a clip and two photographs
                still uploads in the right one.
              </p>
              <p>
                A picture from your Winnow leaves from its full-size original only where the
                proxy in the Library could not fill the frame — a landscape proxy cropped to
                4:5 already falls short, at ×1.25. Fetched originals are kept for this session
                only. <em>Delivers</em> says what the open picture will really give.
              </p>
              <p>
                The export buttons are pinned at the bottom of this tab: the piece, and in their
                menu every slide as a still (what a browser with no video encoder can still
                write, or a contact sheet of a reel), the open slide as a PNG, and the hook as a
                video.{' '}
                {hookIsVideoSlide
                  ? hookIsVideo
                    ? slides[0].speed !== 1
                      ? `The hook’s clip starts on its in point and plays at ${slides[0].speed}×, so the badge animates in on the first frame at its own pace. A re-timed clip goes out without sound`
                      : 'The hook’s clip starts on its in point, so the badge animates in on the first frame. Audio is copied through'
                    : 'The hook is painted over its photograph, frame by frame, so its entrance plays. It comes out silent — there is no track to copy'
                  : hookFile
                    ? 'The hook goes out as an image: nothing on it moves. Give it an animation on the Look tab, or set the slide to Video to hold it as a card'
                    : 'Give the hook a picture from the Library first'}
                {graded || ownGrades > 0
                  ? ownGrades > 0
                    ? `, and each picture goes through the grade it wears — ${
                        ownGrades === 1 ? 'one of them has a look of its own' : `${ownGrades} of them have a look of their own`
                      }.`
                    : `, and every picture goes through ${gradeScope === 'post' ? 'this piece’s own' : 'the trip’s'} grade.`
                  : '; nothing is graded — no grade is set.'}
              </p>
            </>
          }
        >
          {/* A sentence that says "transcode it first" must offer the transcode
              where it is read, or it is a dead end. Once done, the next export
              reads the H.264 by itself. */}
          {undecodable && (
            <div className={`${note} flex flex-col gap-2`}>
              <span>
                {transcode.status === 'done'
                  ? `${undecodable.name} is transcoded to H.264 — export again and it is what goes out.`
                  : `${undecodable.name} cannot be decoded for export here (DJI footage is often HEVC/H.265). Transcode it to H.264 in the browser, then export again.`}
              </span>
              {transcode.status !== 'done' && <TranscodeControl state={transcode} />}
            </div>
          )}

          <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
            {plan.items.map((item) => (
              <li key={`${item.kind}-${item.position}`} className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-3 items-baseline">
                <span className="font-mono text-xs tabular-nums text-muted">
                  {String(item.position).padStart(2, '0')} ·{' '}
                  {item.medium === 'video'
                    ? `${item.seconds.toFixed(1)}s${item.speed !== 1 ? ` ${item.speed}×` : ''}`
                    : 'still'}
                </span>
                <span
                  className={`min-w-0 truncate text-sm ${item.blocker ? 'text-faint line-through' : 'text-ink'}`}
                  title={`${item.name}${item.silent ? ' · silent' : ''}`}
                >
                  {item.name}
                  {item.silent && <span className="text-muted"> · silent</span>}
                </span>
              </li>
            ))}
          </ul>

          {/* The hook's own reason, spelled out: it is the line an author
              changes most, and a word in a column does not explain itself. */}
          {plan.items[0] && (
            <p className="m-0 text-xs text-muted">
              {reasonSentence(plan.items[0].reason, plan.items[0].seconds, plan.items[0].speed)}
            </p>
          )}
          {plan.blockers.map((b) => (
            <p key={b} className="m-0 text-xs text-danger">
              {b}
            </p>
          ))}

          <FieldRow
            label="Delivers"
            align="start"
            hint={delivery?.reason ?? (delivery ? undefined : 'measured for the picture on screen, once it is in the Library')}
          >
            <span className={`font-mono text-sm tabular-nums leading-snug pt-1 ${delivery ? 'text-ink' : 'text-muted'}`}>
              {delivery ? delivery.line : '—'}
            </span>
          </FieldRow>

        </InspectorSection>

        <InspectorSection
          id="piece.export.studio"
          title="Studio"
          info={
            <>
              <p>
                Link the Studio project this clip is graded in and the badge can be sent
                there as an intro scene — with the trip&rsquo;s closing card as the project&rsquo;s
                outro when this piece closes on it. One export then carries the grade, the
                telemetry, the hook and the end card, with nothing left to join afterwards.
              </p>
              <p>
                Sending again replaces the last one and touches nothing else. The shades
                go too, as the scene&rsquo;s own: the same gradients, arriving and leaving
                with the hook. A shade that follows the badge is sent as the shape it
                draws now — in the Studio it no longer follows anything.
              </p>
            </>
          }
        >
          <StudioLink
            post={post}
            elements={hookElements}
            shades={post.badge.shades}
            block={hookBlock}
            cta={trip.cta}
            aspect={aspect}
            file={hookFile}
            hookSeconds={hookSeconds}
            onChangePost={onChangePost}
            grade={grade}
            gradeScope={gradeScope}
          />
        </InspectorSection>
      </LockSections>
    </div>
  );
}
