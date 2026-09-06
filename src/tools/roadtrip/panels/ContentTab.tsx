import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  counterPreviews,
  type BadgeContent,
  type BadgePiece,
} from '../../../shared/roadtrip/day-badge';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import { readCaptureDate, type CaptureDate } from '../../../shared/roadtrip/media-date';
import { timeAgoPreviews } from '../../../shared/roadtrip/time-ago';
import { postDayRange, stageAt } from '../../../shared/roadtrip/trip-coverage';
import { formatIsoDate, isWithin, todayIso } from '../../../shared/roadtrip/trip-days';
import type { PostBadge, TripDoc, TripPost } from '../../../shared/roadtrip/trip-types';
import PiecePicker from './PiecePicker';
import { inputClass, legend, linkButton, note, optionClass, section, smallButton } from './ui';

interface ContentTabProps {
  trip: TripDoc;
  post: TripPost;
  slide: DeckSlide;
  /** The badge's words for this post, or null when the trip cannot be counted. */
  content: BadgeContent | null;
  piece: BadgePiece;
  onPiece: (piece: BadgePiece) => void;
  /** The picture the open slide composes over, for its capture date. */
  slideFile: File | null;
  onChangePost: (post: TripPost) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  patchSlide: (patch: { caption?: string }) => void;
  /** The field a stage click focuses: the piece's text on the hook, the caption elsewhere. */
  textFieldRef: RefObject<HTMLInputElement>;
  /** The closing card is edited on the Deck tab; a click on it goes there. */
  onGoToDeck: () => void;
}

/**
 * What the piece SAYS: the badge's words on the hook, the caption on a
 * content picture, and the day every number is counted from. Each counter
 * and temporal mode shows the line it would really draw for this post, or
 * why it cannot — a fabricated example reads as a broken feature.
 */
export default function ContentTab({
  trip,
  post,
  slide,
  content,
  piece,
  onPiece,
  slideFile,
  onChangePost,
  patchBadge,
  patchSlide,
  textFieldRef,
  onGoToDeck,
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
  const modePreviews = useMemo(
    () => counterPreviews(trip, post, trip.badgeWords, post.badge.showPin),
    [trip, post],
  );
  const activeMode = modePreviews.find((m) => m.id === post.badge.mode) ?? null;

  /** What the temporal line actually says, so the panel shows it rather than
   *  describing it — a mode that has nothing true to say must be visible. */
  const reference = post.badge.referenceDate ?? todayIso();
  const timePreviews = useMemo(
    () => timeAgoPreviews(post.date, reference, trip.badgeWords.time),
    [post.date, reference, trip.badgeWords.time],
  );
  const timeLine = timePreviews.find((p) => p.id === post.badge.timeAgo)?.text ?? null;

  return (
    <div className="flex flex-col gap-4">
      {isHook && (
        <div className={section}>
          <span className={legend}>Piece · what it says</span>
          <PiecePicker piece={piece} onPiece={onPiece} />
          <label className="flex flex-col gap-1">
            <span className={legend}>Text</span>
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
            <span className="text-[0.68rem] text-faint">
              Empty follows the trip — clearing it always gives the computed value back.
            </span>
          </label>
          {!content && (
            <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
              This trip’s dates read backwards, so there is no total to count towards.
              Fix them and the badge comes back.
            </p>
          )}
        </div>
      )}

      {slide.kind === 'content' && (
        <div className={section}>
          <label className="flex flex-col gap-1">
            <span className={legend}>Caption</span>
            <input
              ref={textFieldRef}
              value={slide.caption}
              onChange={(e) => patchSlide({ caption: e.target.value })}
              placeholder="A line over this picture — optional"
              className={inputClass}
            />
          </label>
          <span className="text-[0.68rem] text-faint">
            The counter did its work on the hook; a content picture carries a line at
            most.
          </span>
        </div>
      )}

      {slide.kind === 'cta' && (
        <div className={section}>
          <span className={legend}>Closing card</span>
          <p className="m-0 text-[0.78rem] text-ink-soft">
            This slide is the trip’s call to action, shared by every deck that closes
            with it.
          </p>
          <button type="button" onClick={onGoToDeck} className={`self-start ${smallButton}`}>
            Edit it on the Deck tab
          </button>
        </div>
      )}

      {/* The day belongs to the PIECE, not to a slide: it is what every
          number on the badge is counted from, and it must not vanish on a
          carousel's second picture. */}
      <div className={section}>
        <span className={legend}>The day this piece tells</span>
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
        {captured ? (
          <p className="m-0 text-[0.74rem] text-muted">
            The picture is dated{' '}
            <span className="text-ink">{formatIsoDate(captured.date)}</span>{' '}
            {captured.source === 'exif'
              ? '(the camera’s own record)'
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
        ) : (
          <p className="m-0 text-[0.74rem] text-faint">
            Everything the badge says is counted from this day.
          </p>
        )}
        <label className="flex flex-col gap-1">
          <span className={legend}>Through (for a range)</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={post.endDate ?? ''}
              min={post.date}
              onChange={(e) => onChangePost({ ...post, endDate: e.target.value || null })}
              className={`${inputClass} flex-1 min-w-0`}
            />
            {post.endDate && (
              <button
                type="button"
                onClick={() => onChangePost({ ...post, endDate: null })}
                className={`flex-none ${linkButton}`}
              >
                One day
              </button>
            )}
          </div>
        </label>
      </div>

      {isHook && (
        <>
          <div className={section}>
            <span className={legend}>Counter · what it counts</span>
            {/* Each mode shows the line it would really draw for this post, or
                why it cannot draw one. Fabricated examples made three of the
                four look inert: clicking changed nothing and said nothing. */}
            <div className="flex flex-col gap-1.5">
              {modePreviews.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => patchBadge({ mode: m.id })}
                  aria-pressed={m.id === post.badge.mode}
                  className={optionClass(m.id === post.badge.mode)}
                >
                  <span
                    className={`block text-[0.78rem] ${
                      m.id === post.badge.mode ? 'text-accent-ink font-semibold' : 'text-ink-soft'
                    }`}
                  >
                    {m.label}
                  </span>
                  <span
                    className={`block font-mono text-[0.7rem] ${m.text ? 'text-ink' : 'text-faint'}`}
                  >
                    {m.text ?? m.reason}
                  </span>
                </button>
              ))}
            </div>
            {activeMode?.reason && (
              <p className={`${note} text-muted`}>
                {activeMode.reason}{' '}
                {activeMode.id === 'day-range'
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

          <div className={section}>
            <span className={legend}>Time · the line about when, under the place</span>
            {/* Each mode shows the line it would really draw for this
                picture on the reading day below — never an example. */}
            <div className="flex flex-col gap-1.5">
              {timePreviews.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => patchBadge({ timeAgo: m.id })}
                  title={m.hint}
                  aria-pressed={post.badge.timeAgo === m.id}
                  className={optionClass(post.badge.timeAgo === m.id)}
                >
                  <span
                    className={`block text-[0.78rem] ${
                      post.badge.timeAgo === m.id
                        ? 'text-accent-ink font-semibold'
                        : 'text-ink-soft'
                    }`}
                  >
                    {m.label}
                  </span>
                  <span
                    className={`block font-mono text-[0.7rem] ${m.text ? 'text-ink' : 'text-faint'}`}
                  >
                    {m.id === 'off' ? 'no line' : (m.text ?? 'nothing true to say on that day')}
                  </span>
                </button>
              ))}
            </div>

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
              <span className="text-[0.68rem] text-faint">
                The day this goes out. Set it ahead and the line reads correctly then,
                not now.
              </span>
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
