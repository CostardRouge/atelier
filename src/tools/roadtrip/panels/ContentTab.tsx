import { useEffect, useMemo, useState, type RefObject } from 'react';
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
import SlideDelivery from './SlideDelivery';
import { inputClass, linkButton } from './ui';
import { DateField } from '../../../shared/ui/DateField';
import Button from '../../../shared/ui/Button';
import {
  FieldRow,
  InspectorSection,
  Readout,
  SelectField,
  ToggleField,
} from '../../../shared/ui/Inspector';
import type { TrimRange } from '../../../shared/media/trim';

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
  /**
   * What took the HOOK's picture, as the badge would credit it — null while it
   * is being read, and for a picture that records nothing. Measured in the
   * editor from the file itself, never stored on the piece.
   */
  exposure: string | null;
  /** The open slide's clip length, or 0 when its picture is not one. */
  clipSeconds: number;
  /** The open clip's stretch and speed, when the slide is a clip. */
  clip?: { range: TrimRange; speed: number; onSpeed: (speed: number) => void } | null;
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
 * why it cannot — a fabricated example reads as a broken feature: a select
 * option carries that line, and the chosen one is repeated under it.
 *
 * Laid out in the inspector's grammar (`shared/ui/Inspector`): folding
 * sections of label-and-control rows.
 */

/** A mode as the select offers it: the line it would draw, or why it cannot. */
interface ChoiceOption<Id extends string> {
  id: Id;
  label: string;
  text: string | null;
  otherwise: string;
  hint?: string;
}
export default function ContentTab({
  trip,
  post,
  slide,
  content,
  piece,
  slideFile,
  exposure,
  clipSeconds,
  clip,
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

  const slideName =
    slide.kind === 'hook' ? 'Hook' : slide.kind === 'cta' ? 'Closing card' : `Picture ${slide.position}`;

  return (
    <div className="flex flex-col">
      <InspectorSection
        id="piece.slide"
        title="Slide"
        badge={slideName}
        info={
          <>
            <p>
              A slide goes out as a video when something on it moves — an animated badge,
              a clip — and as an image otherwise. Say so explicitly when you want the
              other one: a still of an animated hook is how a piece gets its grid picture,
              and a photograph held for a few seconds is how it opens a reel.
            </p>
            {isHook && (
              <p>
                The text is what this piece of the badge says. Leave it empty and it
                follows the trip — clearing it always gives the computed value back.
              </p>
            )}
          </>
        }
      >
        {isHook && (
          <FieldRow
            label="Text"
            hint={
              !content ? (
                <span className="text-danger" role="alert">
                  This trip’s dates read backwards, so there is no total to count towards.
                  Fix them and the badge comes back.
                </span>
              ) : undefined
            }
          >
            <input
              ref={textFieldRef}
              value={post.badge.textOverrides[piece] ?? ''}
              placeholder={content?.[piece] ?? '(nothing here)'}
              onChange={(e) =>
                patchBadge({
                  textOverrides: { ...post.badge.textOverrides, [piece]: e.target.value },
                })
              }
              aria-label="Text"
              className={`${inputClass} w-full`}
            />
          </FieldRow>
        )}

        {slide.kind === 'content' && (
          <FieldRow label="Caption">
            <input
              ref={textFieldRef}
              value={slide.caption}
              onChange={(e) => patchSlide({ caption: e.target.value })}
              placeholder="A line over this picture — optional"
              aria-label="Caption"
              className={`${inputClass} w-full`}
            />
          </FieldRow>
        )}

        {slide.kind === 'cta' && (
          <FieldRow label="Card" hint="The trip’s call to action, shared by every deck that closes with it.">
            <Button size="sm" onClick={onEditClosingCard}>
              Edit in the trip’s settings
            </Button>
          </FieldRow>
        )}

        {/* What this slide is DELIVERED as, decided where it is composed. The
            closing card is left out on purpose: its medium is structural. */}
        {slide.kind !== 'cta' && (
          <SlideDelivery
            slide={slide}
            animated={isHook && hookAnimates(post.badge.pieceStyles)}
            clipSeconds={clipSeconds}
            clip={clip}
            onMedium={(medium) => (isHook ? patchBadge({ medium }) : patchSlide({ medium }))}
            onSeconds={(seconds) =>
              isHook ? patchBadge({ hookSeconds: seconds }) : patchSlide({ seconds })
            }
          />
        )}
      </InspectorSection>

      {/* The day belongs to the PIECE, not to a slide: it is what every
          number on the badge is counted from, and it must not vanish on a
          carousel's second picture. */}
      <InspectorSection
        id="piece.day"
        title="Day"
        info={<p>Everything the badge says is counted from this day.</p>}
      >
        <FieldRow
          label={showRange ? 'From' : 'Day'}
          hint={
            captured ? (
              <>
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
                      className={linkButton}
                    >
                      file it under that day
                    </button>
                  </>
                )}
                {capturedOutsideTrip && (
                  <span className="text-danger">
                    {' '}
                    — outside this trip’s dates, so every count here would be about a day
                    this picture has nothing to do with.
                  </span>
                )}
              </>
            ) : undefined
          }
        >
          <DateField
            value={post.date}
            onChange={(date) => onChangePost({ ...post, date })}
            label="The day this piece tells"
            format={formatIsoDate}
            className="min-w-0"
          />
          <Readout muted>{dayOfTrip}</Readout>
        </FieldRow>
        {showRange ? (
          <FieldRow label="Through">
            <DateField
              value={post.endDate ?? ''}
              min={post.date}
              onChange={(endDate) => onChangePost({ ...post, endDate: endDate || null })}
              label="Through"
              format={formatIsoDate}
              className="min-w-0"
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
          </FieldRow>
        ) : (
          <FieldRow label="">
            <button type="button" onClick={() => setWantRange(true)} className={linkButton}>
              This piece covers several days…
            </button>
          </FieldRow>
        )}
      </InspectorSection>

      {isHook && (
        <InspectorSection
          id="piece.counter"
          title="Counter"
          info={
            <p>
              The number the badge leads with. Every way of counting says the line it
              would really draw for this piece, or the reason it cannot draw one.
            </p>
          }
        >
          <FieldRow
            label="Mode"
            hint={
              counterReason ? (
                <>
                  {counterReason}{' '}
                  {post.badge.mode === 'day-range'
                    ? 'It counts the single day above meanwhile.'
                    : 'Stages are edited on the trip’s Overview; the day of the trip is counted meanwhile.'}
                </>
              ) : activeCounter?.text ? (
                <span className="font-mono text-ink">{activeCounter.text}</span>
              ) : undefined
            }
          >
            <SelectField
              label="Counter"
              value={post.badge.mode}
              onChange={(mode) => patchBadge({ mode })}
              options={counterOptions.map((o) => ({
                id: o.id,
                label: `${o.label} · ${o.text ?? o.otherwise}`,
              }))}
            />
          </FieldRow>
          <FieldRow
            label="Marker"
            hint={
              place
                ? `The place reads “${place}”.`
                : 'No stage covers this day, so there is no place to mark — add one on the Overview.'
            }
          >
            <ToggleField
              label="Marker before the place"
              checked={post.badge.showPin}
              onChange={(showPin) => patchBadge({ showPin })}
            >
              Before the place
            </ToggleField>
          </FieldRow>
          {/* The real line this picture would draw, or why it cannot — never
              an example: a fabricated “ƒ/1.7 · 1/240” over a photograph that
              records none of it reads as a broken feature. */}
          <FieldRow
            label="Camera"
            hint={
              exposure ? (
                <span className="font-mono text-ink">“{exposure}”</span>
              ) : (
                'This picture records no camera, lens or exposure — nothing to credit. Write the line yourself on the Camera piece if you want one.'
              )
            }
          >
            <ToggleField
              label="Credit the camera"
              checked={post.badge.showExif}
              onChange={(showExif) => patchBadge({ showExif })}
            >
              Under the badge
            </ToggleField>
          </FieldRow>
        </InspectorSection>
      )}

      {isHook && (
        <InspectorSection
          id="piece.time"
          title="Time"
          info={
            <p>
              The line about when, drawn under the place. It is worked out for the day
              the piece goes out — set that day ahead and it reads correctly then, not now.
            </p>
          }
        >
          <FieldRow
            label="Mode"
            hint={
              timeLine ? (
                <span className="font-mono text-ink">“{timeLine}”</span>
              ) : post.badge.timeAgo === 'off' ? (
                'No line about when. The trip’s name is on the badge either way.'
              ) : post.badge.timeAgo === 'anniversary' ? (
                'Not the anniversary on that day, so the line is left out. Nothing claims a date it is not.'
              ) : (
                'Nothing true to say about that gap yet, so the line is left out.'
              )
            }
          >
            <SelectField
              label="Time"
              value={post.badge.timeAgo}
              onChange={(timeAgo) => patchBadge({ timeAgo })}
              options={timeOptions.map((o) => ({
                id: o.id,
                label: o.text ? `${o.label} · ${o.text}` : o.label,
              }))}
            />
          </FieldRow>
          <FieldRow label="Read on">
            <DateField
              value={post.badge.referenceDate ?? todayIso()}
              onChange={(referenceDate) => patchBadge({ referenceDate })}
              label="Read on"
              format={formatIsoDate}
              className="min-w-0"
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
          </FieldRow>
        </InspectorSection>
      )}
    </div>
  );
}
