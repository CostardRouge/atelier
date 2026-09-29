import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  counterPreviews,
  type BadgeContent,
  type BadgePiece,
  type CounterMode,
} from '../../../shared/roadtrip/day-badge';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import {
  createSlideText,
  hasOwnInk,
  withLineInk,
  type SlideBadge,
} from '../../../shared/roadtrip/slide-capacities';
import { BLEND_MODES, type BlendMode } from '../../../shared/overlay/blend';
import KnockoutRows from '../../../shared/overlay/KnockoutRows';
import type { OverlayElement } from '../../../shared/overlay/overlay-types';
import IconButton from '../../../shared/ui/IconButton';
import { Icons } from '../../../shared/ui/icons';
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
import type { ExifData } from '../../../shared/exif/exif-parser';
import CameraPanel from './CameraPanel';
import SlideDelivery from './SlideDelivery';
import { inputClass, linkButton } from './ui';
import { DateField } from '../../../shared/ui/DateField';
import Button from '../../../shared/ui/Button';
import {
  FieldRow,
  InspectorSection,
  RangeField,
  Readout,
  SelectField,
  ToggleField,
} from '../../../shared/ui/Inspector';
import type { TrimRange } from '../../../shared/media/trim';

interface ContentTabProps {
  trip: TripDoc;
  post: TripPost;
  slide: DeckSlide;
  /**
   * What the OPEN slide's badge says — the piece's on the first slide, the
   * slide's own elsewhere — or null when it draws none or cannot be counted.
   */
  content: BadgeContent | null;
  /** The piece in hand — chosen above the tabs, or by a click on the stage. */
  piece: BadgePiece;
  /** The picture the open slide composes over, for its capture date. */
  slideFile: File | null;
  /**
   * What took the HOOK's picture — its effective EXIF, null while it is being
   * read and for a picture that records nothing. Read in the editor from the
   * file itself; the credit composed from it is never stored on the piece.
   */
  exif: ExifData | null;
  /** The open slide's clip length, or 0 when its picture is not one. */
  clipSeconds: number;
  /** The open clip's stretch and speed, when the slide is a clip. */
  clip?: { range: TrimRange; speed: number; onSpeed: (speed: number) => void } | null;
  onChangePost: (post: TripPost) => void;
  /** The camera credit names a body on the TRIP, once for every piece. */
  onChangeTrip: (trip: TripDoc) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  patchSlide: (patch: Partial<Pick<PostSlide, 'caption' | 'medium' | 'seconds'>>) => void;
  /** Write the open slide's OWN badge — another slide's words, counter and line. */
  patchSlideBadge: (patch: Partial<SlideBadge>) => void;
  /** The open slide's lines of free text, and where they are written. */
  texts: readonly OverlayElement[];
  onTexts: (texts: OverlayElement[]) => void;
  /** The field a stage click on a badge piece focuses. */
  textFieldRef: RefObject<HTMLInputElement>;
  /** The field a stage click on a caption line focuses. */
  captionFieldRef: RefObject<HTMLInputElement>;
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
  exif,
  clipSeconds,
  clip,
  onChangePost,
  onChangeTrip,
  patchBadge,
  patchSlide,
  patchSlideBadge,
  texts,
  onTexts,
  textFieldRef,
  captionFieldRef,
  onEditClosingCard,
}: ContentTabProps) {
  const isHook = slide.kind === 'hook';
  /**
   * The badge this slide's words are written to: the piece's on the first
   * slide, the slide's own elsewhere, none where the slide draws no badge.
   * Only what one slide may say differently goes through it — the marker and
   * the "read on" day stay the piece's, the camera credit the hook's alone.
   */
  const badge: {
    mode: CounterMode;
    timeAgo: TimeAgoMode;
    textOverrides: Partial<Record<BadgePiece, string>>;
    write: (patch: Partial<Pick<PostBadge, 'mode' | 'timeAgo' | 'textOverrides'>>) => void;
  } | null = isHook
    ? { ...post.badge, write: patchBadge }
    : slide.badge
      ? { ...slide.badge, write: patchSlideBadge }
      : null;

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
  const activeCounter = counterOptions.find((m) => m.id === badge?.mode) ?? null;
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
  const timeLine = timeOptions.find((p) => p.id === badge?.timeAgo)?.text ?? null;

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
        {badge && (
          <FieldRow
            label={isHook ? 'Text' : 'Badge text'}
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
              value={badge.textOverrides[piece] ?? ''}
              placeholder={content?.[piece] ?? '(nothing here)'}
              onChange={(e) =>
                badge.write({
                  textOverrides: { ...badge.textOverrides, [piece]: e.target.value },
                })
              }
              aria-label={isHook ? 'Text' : 'Badge text'}
              className={`${inputClass} w-full`}
            />
          </FieldRow>
        )}

        {slide.kind === 'content' && (
          <FieldRow label="Caption">
            <input
              ref={captionFieldRef}
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
            // Whether something on the slide moves, as the deck itself resolved
            // it: `animated` / `settled` are exactly the two reasons that say so,
            // whatever moves — a badge piece, an opener, text, a picture.
            animated={slide.reason === 'animated' || slide.reason === 'settled'}
            clipSeconds={clipSeconds}
            clip={clip}
            onMedium={(medium) => (isHook ? patchBadge({ medium }) : patchSlide({ medium }))}
            onSeconds={(seconds) =>
              isHook ? patchBadge({ hookSeconds: seconds }) : patchSlide({ seconds })
            }
          />
        )}
      </InspectorSection>

      {/* Free lines over the picture, on any slide but the closing card —
          the second thing, after an opener, a slide is most often given. */}
      {slide.kind !== 'cta' && (
        <InspectorSection
          id="piece.texts"
          title="Text"
          badge={texts.length ? String(texts.length) : undefined}
          info={
            <p>
              Free lines over this picture — a place, an hour, a word. They wear the trip’s
              title style like a caption does, never the badge’s glow or panel. Drag a line
              on the picture to place it; hold Alt to skip the snap.
            </p>
          }
        >
          {texts.map((el, i) => {
            const write = (patch: Partial<OverlayElement>) =>
              onTexts(texts.map((t) => (t.id === el.id ? { ...t, ...patch } : t)));
            return (
              <div key={el.id} className="flex flex-col">
                <FieldRow label={`Line ${i + 1}`}>
                  <input
                    data-text-id={el.id}
                    value={el.text ?? ''}
                    onChange={(e) => write({ text: e.target.value })}
                    placeholder="A word over this picture"
                    aria-label={`Line ${i + 1}`}
                    className={`${inputClass} w-full min-w-0`}
                  />
                  <IconButton
                    label={`Remove line ${i + 1}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => onTexts(texts.filter((t) => t.id !== el.id))}
                  >
                    {Icons.trash}
                  </IconButton>
                </FieldRow>
                <FieldRow label="Size">
                  <RangeField
                    label={`Line ${i + 1} size`}
                    min={0.02}
                    max={0.3}
                    step={0.005}
                    value={el.sizeFrac}
                    onChange={(sizeFrac) => write({ sizeFrac })}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                </FieldRow>
                <KnockoutRows
                  label={`Line ${i + 1}`}
                  value={el.knockout}
                  onChange={(knockout) => write({ knockout })}
                />
                {/* A masked line is bare letters in the mask's own colour: a
                    blend or an ink would change nothing it draws. */}
                {!el.knockout && (
                  <>
                    <FieldRow
                      label="Blend"
                      hint={BLEND_MODES.find((m) => m.id === (el.blend ?? 'normal'))?.hint}
                    >
                      <SelectField
                        label={`Line ${i + 1} blend`}
                        value={el.blend ?? 'normal'}
                        onChange={(blend: BlendMode) => write({ blend })}
                        options={BLEND_MODES.map((m) => ({ id: m.id, label: m.label }))}
                      />
                    </FieldRow>
                    <FieldRow label="Ink">
                      <input
                        type="color"
                        aria-label={`Line ${i + 1} ink`}
                        value={el.color.startsWith('#') ? el.color : '#ffffff'}
                        onChange={(e) =>
                          onTexts(
                            texts.map((t) => (t.id === el.id ? withLineInk(t, e.target.value) : t)),
                          )
                        }
                        className="h-7 w-10 rounded-control border border-line-strong bg-paper cursor-pointer"
                      />
                      {hasOwnInk(el) ? (
                        <button
                          type="button"
                          onClick={() =>
                            onTexts(texts.map((t) => (t.id === el.id ? withLineInk(t, null) : t)))
                          }
                          className={`flex-none ${linkButton}`}
                        >
                          The trip’s
                        </button>
                      ) : (
                        <Readout muted>the trip’s</Readout>
                      )}
                    </FieldRow>
                  </>
                )}
              </div>
            );
          })}
          <FieldRow label={texts.length ? '' : 'Lines'}>
            <Button
              size="sm"
              icon={Icons.plus}
              aria-label="Add a line of text"
              onClick={() => onTexts([...texts, createSlideText()])}
            >
              Text
            </Button>
          </FieldRow>
        </InspectorSection>
      )}

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

      {badge && (
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
                  {badge.mode === 'day-range'
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
              value={badge.mode}
              onChange={(mode) => badge.write({ mode })}
              options={counterOptions.map((o) => ({
                id: o.id,
                label: `${o.label} · ${o.text ?? o.otherwise}`,
              }))}
            />
          </FieldRow>
          {isHook && (
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
          )}
        </InspectorSection>
      )}

      {badge && (
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
              ) : badge.timeAgo === 'off' ? (
                'No line about when. The trip’s name is on the badge either way.'
              ) : badge.timeAgo === 'anniversary' ? (
                'Not the anniversary on that day, so the line is left out. Nothing claims a date it is not.'
              ) : (
                'Nothing true to say about that gap yet, so the line is left out.'
              )
            }
          >
            <SelectField
              label="Time"
              value={badge.timeAgo}
              onChange={(timeAgo) => badge.write({ timeAgo })}
              options={timeOptions.map((o) => ({
                id: o.id,
                label: o.text ? `${o.label} · ${o.text}` : o.label,
              }))}
            />
          </FieldRow>
          {isHook && (
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
          )}
        </InspectorSection>
      )}

      {isHook && (
        <InspectorSection
          id="piece.camera"
          title="Camera"
          info={
            <p>
              What took the picture, credited on it. Every value is read from the
              picture itself and never stored: pick the facts, their order, a layout
              and where it sits. A picture that records nothing credits nothing.
            </p>
          }
        >
          <CameraPanel
            trip={trip}
            post={post}
            exif={exif}
            patchBadge={patchBadge}
            onChangeTrip={onChangeTrip}
          />
        </InspectorSection>
      )}
    </div>
  );
}
