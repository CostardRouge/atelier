import { useEffect, useMemo, useState, type RefObject } from 'react';
import SectionLegend from '../../../shared/ui/SectionLegend';
import {
  counterPreviews,
  type BadgeContent,
  type BadgePiece,
  type CounterMode,
} from '../../../shared/roadtrip/day-badge';
import { hookAnimates, type DeckSlide } from '../../../shared/roadtrip/deck';
import { readCaptureDate, type CaptureDate } from '../../../shared/roadtrip/media-date';
import { timeAgoPreviews, type TimeAgoMode } from '../../../shared/roadtrip/time-ago';
import { postDayRange, stageAt } from '../../../shared/roadtrip/trip-coverage';
import { formatIsoDate, isWithin, todayIso } from '../../../shared/roadtrip/trip-days';
import type {
  PostBadge,
  PostSlide,
  TripDoc,
  TripPost,
} from '../../../shared/roadtrip/trip-types';
import ModeChoice, { type ChoiceOption } from './ModeChoice';
import SlideDelivery from './SlideDelivery';
import { inputClass, legend, linkButton, note, smallButton } from './ui';

interface ContentTabProps {
  trip: TripDoc;
  post: TripPost;
  slide: DeckSlide;
  /** The badge's words for this post, or null when the trip cannot be counted. */
  content: BadgeContent | null;
  /** The piece in hand — chosen above the tabs, or by a click on the stage. */
  piece: BadgePiece;
  /** The picture the open slide composes over, for its capture date. */
  slideFile: File | null;
  /** The open slide's clip length, or 0 when its picture is not one. */
  clipSeconds: number;
  onChangePost: (post: TripPost) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  patchSlide: (patch: Partial<Pick<PostSlide, 'caption' | 'medium' | 'seconds'>>) => void;
  /** The field a stage click focuses: the piece's text on the hook, the caption elsewhere. */
  textFieldRef: RefObject<HTMLInputElement>;
  /** The closing card belongs to the trip; a click on it opens that sheet. */
  onEditClosingCard: () => void;
}

/**
 * What the piece SAYS: the badge's words on the hook, the caption on a
 * content picture, and the day every number is counted from. Each counter and
 * temporal mode still shows the line it would really draw for this post, or
 * why it cannot — a fabricated example reads as a broken feature — but only
 * the chosen one is on screen until you ask for the others (`ModeChoice`).
 */
export default function ContentTab({
  trip,
  post,
  slide,
  content,
  piece,
  slideFile,
  clipSeconds,
  onChangePost,
  patchBadge,
  patchSlide,
  textFieldRef,
  onEditClosingCard,
}: ContentTabProps) {
  const isHook = slide.kind === 'hook';

  // --- the day the picture was actually taken -------------------------------
  // Every number the badge draws is a subtraction from the day the piece is
  // filed under, so a picture filed under the wrong day reads confidently
  // wrong. The file is measured and the answer offered; the author still
  // decides — nothing here rewrites a post on its own.
  const [captured, setCaptured] = useState<CaptureDate | null>(null);
  useEffect(() => {
    if (!slideFile) {
      setCaptured(null);
      return;
    }
    let alive = true;
    void readCaptureDate(slideFile).then((d) => {
      if (alive) setCaptured(d);
    });
    return () => {
      alive = false;
    };
  }, [slideFile]);

  // A range is the rare case: the field only appears once there is one, or
  // once it is asked for.
  const [wantRange, setWantRange] = useState(false);
  const showRange = wantRange || post.endDate !== null;

  const capturedElsewhere = captured !== null && captured.date !== post.date;
  const capturedOutsideTrip =
    captured !== null && !isWithin(trip.startDate, trip.endDate, captured.date);

  /** Where the day lands in the trip, and what the trip calls that place. */
  const range = postDayRange(trip, post);
  const dayOfTrip = range
    ? `day ${range.from}${range.to > range.from ? `–${range.to}` : ''} / ${range.total}`
    : 'outside the trip';
  const place = stageAt(trip, post.date)?.name.trim() || null;

  /** What each counter mode would really say for THIS post — or why it cannot. */
  const counterOptions = useMemo<ChoiceOption<CounterMode>[]>(
    () =>
      counterPreviews(trip, post, trip.badgeWords, post.badge.showPin).map((m) => ({
        id: m.id,
        label: m.label,
        hint: m.hint,
        text: m.text,
        otherwise: m.reason ?? 'nothing to count here',
      })),
    [trip, post],
  );
  const activeCounter = counterOptions.find((m) => m.id === post.badge.mode) ?? null;
  const counterReason = activeCounter?.text === null ? activeCounter.otherwise : null;

  /** What the temporal line actually says, so the panel shows it rather than
   *  describing it — a mode that has nothing true to say must be visible. */
  const reference = post.badge.referenceDate ?? todayIso();
  const timeOptions = useMemo<ChoiceOption<TimeAgoMode>[]>(
    () =>
      timeAgoPreviews(post.date, reference, trip.badgeWords.time).map((m) => ({
        id: m.id,
        label: m.label,
        hint: m.hint,
        text: m.id === 'off' ? null : m.text,
        otherwise: m.id === 'off' ? 'no line' : 'nothing true to say on that day',
      })),
    [post.date, reference, trip.badgeWords.time],
  );
  const timeLine = timeOptions.find((p) => p.id === post.badge.timeAgo)?.text ?? null;

  return (
    <div className="flex flex-col gap-4">
      {isHook && (
        <label className="flex flex-col gap-1.5">
          <SectionLegend label="Text">
            <p>
              What this piece of the badge says. Leave it empty and it follows the
              trip — clearing it always gives the computed value back.
            </p>
          </SectionLegend>
          <input
            ref={textFieldRef}
            value={post.badge.textOverrides[piece] ?? ''}
            placeholder={content?.[piece] ?? '(nothing here)'}
            onChange={(e) =>
              patchBadge({
                textOverrides: { ...post.badge.textOverrides, [piece]: e.target.value },
              })
            }
            className={inputClass}
          />
          {!content && (
            <span className="text-[0.78rem] text-[#9a3a23]" role="alert">
              This trip’s dates read backwards, so there is no total to count towards.
              Fix them and the badge comes back.
            </span>
          )}
        </label>
      )}

      {slide.kind === 'content' && (
        <label className="flex flex-col gap-1.5">
          <SectionLegend label="Caption">
            <p>
              The counter did its work on the hook; a content picture carries a line at
              most.
            </p>
          </SectionLegend>
          <input
            ref={textFieldRef}
            value={slide.caption}
            onChange={(e) => patchSlide({ caption: e.target.value })}
            placeholder="A line over this picture — optional"
            className={inputClass}
          />
        </label>
      )}

      {slide.kind === 'cta' && (
        <div className="flex flex-col gap-2">
          <span className={legend}>Closing card</span>
          <p className="m-0 text-[0.78rem] text-ink-soft">
            This slide is the trip’s call to action, shared by every deck that closes
            with it.
          </p>
          <button
            type="button"
            onClick={onEditClosingCard}
            className={`self-start ${smallButton}`}
          >
            Edit it in the trip’s settings
          </button>
        </div>
      )}

      {/* What this slide is DELIVERED as, decided where it is composed. The
          closing card is left out on purpose: its medium is structural — a
          card with no picture and nothing animated is a still, and inside a
          reel it is the tail the export already appends. */}
      {slide.kind !== 'cta' && (
        <SlideDelivery
          slide={slide}
          animated={isHook && hookAnimates(post.badge.pieceStyles)}
          clipSeconds={clipSeconds}
          onMedium={(medium) =>
            isHook ? patchBadge({ medium }) : patchSlide({ medium })
          }
          onSeconds={(seconds) =>
            isHook ? patchBadge({ hookSeconds: seconds }) : patchSlide({ seconds })
          }
        />
      )}

      {/* The day belongs to the PIECE, not to a slide: it is what every
          number on the badge is counted from, and it must not vanish on a
          carousel's second picture. */}
      <div className="flex flex-col gap-2">
        <SectionLegend label="The day this piece tells">
          <p>Everything the badge says is counted from this day.</p>
        </SectionLegend>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={post.date}
            onChange={(e) => onChangePost({ ...post, date: e.target.value })}
            className={`${inputClass} flex-1 min-w-0`}
            aria-label="The day this piece tells"
          />
          <span className="flex-none font-mono text-[0.68rem] text-muted tabular-nums">
            {dayOfTrip}
          </span>
        </div>
        {captured && (
          <p className="m-0 text-[0.74rem] text-muted">
            The picture is dated{' '}
            <span className="text-ink">{formatIsoDate(captured.date)}</span>{' '}
            {captured.source === 'exif'
              ? '(the camera’s own record)'
              : captured.source === 'source'
                ? `(the capture time ${captured.via ?? 'the source'} read at ingest)`
                : '(the file’s date — a copy or an export rewrites it)'}
            {capturedElsewhere && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => onChangePost({ ...post, date: captured.date })}
                  className="p-0 border-0 bg-transparent text-[0.74rem] text-accent-ink cursor-pointer underline underline-offset-[3px]"
                >
                  file it under that day
                </button>
              </>
            )}
            {capturedOutsideTrip && (
              <span className="text-[#9a3a23]">
                {' '}
                — outside this trip’s dates, so every count here would be about a day
                this picture has nothing to do with.
              </span>
            )}
          </p>
        )}
        {showRange ? (
          <label className="flex flex-col gap-1">
            <span className={legend}>Through (for a range)</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={post.endDate ?? ''}
                min={post.date}
                onChange={(e) =>
                  onChangePost({ ...post, endDate: e.target.value || null })
                }
                className={`${inputClass} flex-1 min-w-0`}
              />
              <button
                type="button"
                onClick={() => {
                  onChangePost({ ...post, endDate: null });
                  setWantRange(false);
                }}
                className={`flex-none ${linkButton}`}
              >
                One day
              </button>
            </div>
          </label>
        ) : (
          <button
            type="button"
            onClick={() => setWantRange(true)}
            className={`self-start ${linkButton}`}
          >
            This piece covers several days…
          </button>
        )}
      </div>

      {isHook && (
        <>
          <div className="flex flex-col gap-2">
            <ModeChoice
              label="Counter"
              options={counterOptions}
              value={post.badge.mode}
              onChange={(mode) => patchBadge({ mode })}
            >
              <p>
                The number the badge leads with. Every way of counting shows the line it
                would really draw for this piece, or the reason it cannot draw one.
              </p>
            </ModeChoice>
            {counterReason && (
              <p className={`${note} text-muted`}>
                {counterReason}{' '}
                {post.badge.mode === 'day-range'
                  ? 'It counts the single day above meanwhile.'
                  : 'Stages are edited on the trip’s Overview; the day of the trip is counted meanwhile.'}
              </p>
            )}
            <label className="flex items-center gap-2 text-[0.8rem] text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={post.badge.showPin}
                onChange={(e) => patchBadge({ showPin: e.target.checked })}
                className="accent-accent"
              />
              Marker before the place
            </label>
            <p className="m-0 text-[0.72rem] text-faint">
              {place
                ? `The place reads “${place}”.`
                : 'No stage covers this day, so there is no place to mark — add one on the Overview.'}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <ModeChoice
              label="Time"
              options={timeOptions}
              value={post.badge.timeAgo}
              onChange={(timeAgo) => patchBadge({ timeAgo })}
            >
              <p>
                The line about when, drawn under the place. It is worked out for the day
                the piece goes out — set that day ahead and it reads correctly then, not
                now.
              </p>
            </ModeChoice>

            <label className="flex flex-col gap-1">
              <span className={legend}>Read on</span>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={post.badge.referenceDate ?? todayIso()}
                  onChange={(e) => patchBadge({ referenceDate: e.target.value })}
                  className={`${inputClass} flex-1 min-w-0`}
                />
                {post.badge.referenceDate && (
                  <button
                    type="button"
                    onClick={() => patchBadge({ referenceDate: null })}
                    className={`flex-none ${linkButton}`}
                  >
                    Today
                  </button>
                )}
              </div>
            </label>

            <p className="m-0 px-2.5 py-2 rounded-paper bg-paper border border-line text-[0.8rem]">
              {timeLine ? (
                <span className="text-ink">“{timeLine}”</span>
              ) : (
                <span className="text-muted">
                  {post.badge.timeAgo === 'off'
                    ? 'No line about when. The trip’s name is on the badge either way.'
                    : post.badge.timeAgo === 'anniversary'
                      ? 'Not the anniversary on that day, so the line is left out. Nothing claims a date it is not.'
                      : 'Nothing true to say about that gap yet, so the line is left out.'}
                </span>
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
