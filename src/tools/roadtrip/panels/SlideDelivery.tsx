import { mediumVerb, type DeckSlide, type SlideReason } from '../../../shared/roadtrip/deck';
import { CLIP_SPEEDS, MIN_HOOK_SECONDS, screenSecondsCeiling } from '../../../shared/roadtrip/hook-video';
import {
  DEFAULT_HOLD_SECONDS,
  paceSteps,
  switchOwner,
  type LengthEdit,
  type LengthOver,
} from '../../../shared/roadtrip/slide-length';
import { FIT_FLOOR_SECONDS } from '../../../shared/roadtrip/slide-timing';
import type { TrimRange } from '../../../shared/media/trim';
import { formatTimecode } from '../../../shared/lib/format';
import { FieldRow, Readout, SliderRow } from '../../../shared/ui/Inspector';
import type { SlideMedium } from '../../../shared/roadtrip/trip-types';
import Button from '../../../shared/ui/Button';
import Segmented from '../../../shared/ui/Segmented';

interface SlideDeliveryProps {
  slide: DeckSlide;
  /** True when something on this slide moves — what makes it a video by itself. */
  animated: boolean;
  /** The clip's length when this slide holds one and it has loaded; else 0. */
  clipSeconds: number;
  /** The open clip's stretch and speed, when the slide is a clip — the same numbers the bar under the picture edits. */
  clip?: { range: TrimRange; speed: number; onSpeed: (speed: number) => void } | null;
  onMedium: (medium: SlideMedium) => void;
  /** Who decides the length, and the slide's own seconds where they ARE the length. */
  onLength: (edit: LengthEdit) => void;
  /** The opener on the slide by its name on screen — «Virée» — or null when nothing on it plays. */
  openerName: string | null;
}

/** The sentence a resolved slide deserves — the real one, never a generic. */
export function reasonSentence(reason: SlideReason, seconds: number, speed = 1): string {
  // A re-timed clip has no sound: audio is copied, never re-encoded. Said
  // here, beside the length, rather than discovered in the file.
  const pace = speed !== 1 ? ` at ${speed}×, without sound` : '';
  switch (reason) {
    case 'animated':
      return `This slide animates, so it goes out as a ${seconds.toFixed(1)}s video${pace}.`;
    case 'moving':
      return `Its picture is a clip, so it goes out as ${seconds.toFixed(1)}s of video${pace}.`;
    case 'forced-video':
      return `A still picture, held for ${seconds.toFixed(1)}s of video because you asked.`;
    case 'settled':
      return 'This slide animates, but you asked for an image: the badge is drawn settled, as it comes to rest.';
    case 'frozen':
      return 'Its picture is a clip, but you asked for an image: the frame you chose is what goes out.';
    case 'plain':
      return 'A still picture, delivered as one.';
  }
}

const PACE_LABEL: Record<string, string> = { '0.5': '½×', '0.75': '¾×', '1': '1×' };
const percent = (scale: number) => `${Math.round(scale * 100)} %`;
const s1 = (seconds: number) => `${seconds.toFixed(1)} s`;

/**
 * What this slide is delivered as, and for how long — decided HERE, where the
 * piece is composed, and never at the door (his call, 2026-09-09).
 *
 * The length is face B of `docs/slide-length.md` (2026-10-13): a slide with
 * an opener is made of PARTS — the opener at a pace, then a hold — and its
 * OWNER is a word the author picks (`Virée decides` · `Fixed`), the one
 * gesture that changes it; the numbers under it are the suite's one slider
 * (`SliderRow`) and write inside that owner. Every control is always drawn,
 * so nothing moves under the pointer; a cut is said in the length's own line,
 * never in a sentence that inserts verbs. The medium is a sentence with ONE
 * verb, not a third «Auto» beside the length's.
 */
export default function SlideDelivery({ slide, animated, clipSeconds, clip, onMedium, onLength, openerName }: SlideDeliveryProps) {
  const name = slide.media?.name ?? null;
  // A clip cannot be held longer than what is left of it after its in point,
  // at its speed — and a read-out that claims 5s over a 3s clip is lying
  // about the file it will write.
  const ceiling = screenSecondsCeiling(slide.videoTimeSeconds, slide.speed, clipSeconds);
  const seconds = Math.min(slide.seconds, ceiling);
  const timing = slide.timing;
  const length = slide.length;
  const opener = openerName !== null && timing.natural > 0 ? openerName : null;
  const follows = opener !== null && length.owner === 'opener';
  const cut = timing.cut > 0.05;
  const sped = timing.scale < 0.999;
  const verb = mediumVerb(slide.chosen, animated, name);

  // The sum, read: what the slide is made of, its cut said in the same line.
  const parts = (() => {
    if (!opener) {
      if (slide.medium === 'video' && clipSeconds > 0 && ceiling < seconds + 0.05) {
        return `All that is left of the clip after its in point${slide.speed !== 1 ? ` at ${slide.speed}×` : ''}.`;
      }
      return 'How long this picture holds the screen when the piece plays.';
    }
    const run = `${opener} ${s1(timing.span)}${sped ? ` at ${percent(timing.scale)}` : ''}`;
    if (cut) {
      const why = follows
        ? slide.medium === 'video' && clipSeconds > 0
          ? 'the clip ends first'
          : 'the slide’s ceiling'
        : length.owner === 'fixed' && length.over === 'cut'
          ? 'you asked to cut it'
          : `faster would show a picture for less than ${FIT_FLOOR_SECONDS} s`;
      return `${run}, its last ${s1(timing.cut)} cut — ${why}.`;
    }
    return `${run} + ${s1(timing.hold)} on the picture.`;
  })();

  const paceId = (() => {
    if (length.owner !== 'opener') return '';
    const step = Object.keys(PACE_LABEL).find((k) => Math.abs(Number(k) - length.pace) < 1e-6);
    return step ?? '';
  })();

  return (
    <>
      <FieldRow label="Goes out as" hint={reasonSentence(slide.reason, seconds, slide.speed)} hintShown>
        <Readout>{slide.medium === 'video' ? 'Video' : 'Image'}</Readout>
        <span className="flex-1" />
        <Button size="sm" onClick={() => onMedium(verb.write)}>
          {verb.label}
        </Button>
      </FieldRow>

      {/* The clip's own numbers, as the audit's inspector drew them: the cut
          is made on the bar under the picture, and read here; the speed is
          one control in both places, writing the same field. */}
      {clip && (
        <>
          <FieldRow label="Range">
            <Readout>
              {formatTimecode(clip.range.start)} → {formatTimecode(clip.range.end)}
            </Readout>
          </FieldRow>
          <FieldRow label="Speed" hint={clip.speed !== 1 ? 'A re-timed clip goes out without sound.' : undefined}>
            <Segmented
              fill
              size="sm"
              label="Clip speed"
              value={String(clip.speed)}
              onChange={(v) => clip.onSpeed(Number(v))}
              options={CLIP_SPEEDS.map((sp) => ({ id: String(sp), label: `${sp}×` }))}
              className="flex-1 min-w-0"
            />
          </FieldRow>
        </>
      )}

      <FieldRow label="On screen" hint={<p className={cut ? 'text-accent-ink' : undefined}>{parts}</p>} hintShown>
        <Readout>{s1(seconds)}</Readout>
      </FieldRow>

      {opener && (
        <FieldRow label="Length">
          <Segmented
            fill
            size="sm"
            label="Who decides how long this slide lasts"
            value={length.owner}
            onChange={(owner) => onLength(switchOwner(owner, length, timing))}
            options={[
              { id: 'opener', label: `${opener} decides`, title: `${opener} at a pace, then a hold: the slide grows when ${opener} does` },
              { id: 'fixed', label: 'Fixed', title: 'The slide lasts exactly the seconds set here' },
            ]}
            className="flex-1 min-w-0"
          />
        </FieldRow>
      )}

      {follows && length.owner === 'opener' ? (
        <>
          <FieldRow
            label="Pace"
            hint={
              timing.floored
                ? `${opener} runs at ${percent(timing.scale)}, its fastest: no picture is shown for less than ${FIT_FLOOR_SECONDS} s.`
                : paceId === ''
                  ? `${percent(length.pace)}, set on the band.`
                  : undefined
            }
            hintShown
          >
            <Segmented
              fill
              size="sm"
              label={`${opener}’s pace`}
              value={paceId}
              onChange={(id) => onLength({ length: { ...length, pace: Number(id) } })}
              options={paceSteps(timing.floor).map((step) => ({
                id: String(step.pace),
                label: PACE_LABEL[String(step.pace)] ?? `${step.pace}×`,
                disabled: step.refused ?? undefined,
              }))}
              className="flex-1 min-w-0"
            />
          </FieldRow>
          <SliderRow
            label="Hold after"
            name={`The picture’s time after ${opener}`}
            min={0}
            max={10}
            step={0.1}
            value={length.hold}
            reset={DEFAULT_HOLD_SECONDS}
            onChange={(hold) => onLength({ length: { ...length, hold } })}
            format={s1}
          />
        </>
      ) : (
        <>
          <SliderRow
            label="Seconds"
            name="How long this slide stays on screen"
            min={MIN_HOOK_SECONDS}
            max={ceiling}
            step={0.1}
            value={seconds}
            onChange={(next) => onLength({ length, seconds: next })}
            format={s1}
          />
          {opener && length.owner === 'fixed' && (
            <FieldRow
              label={`If ${opener} is longer`}
              hint={timing.natural <= seconds + 0.05 ? `${opener} fits: it plays whole at its own pace.` : undefined}
              hintShown
            >
              <Segmented
                fill
                size="sm"
                label={`What a fixed length does with a longer ${opener}`}
                value={length.over}
                onChange={(over: LengthOver) => onLength({ length: { owner: 'fixed', over } })}
                options={[
                  { id: 'fit', label: 'Speed it up', title: `${opener} runs faster to end with the slide` },
                  { id: 'cut', label: 'Cut it', title: `${opener} keeps its pace and the slide’s end cuts it` },
                ]}
                className="flex-1 min-w-0"
              />
            </FieldRow>
          )}
        </>
      )}
    </>
  );
}
