import {
  resolveSlideMedium,
  type DeckSlide,
  type SlideReason,
} from '../../../shared/roadtrip/deck';
import {
  CLIP_SPEEDS,
  MAX_HOOK_SECONDS,
  MIN_HOOK_SECONDS,
  screenSecondsCeiling,
} from '../../../shared/roadtrip/hook-video';
import { AUTO_TAIL_SECONDS, autoSeconds } from '../../../shared/roadtrip/slide-timing';
import type { TrimRange } from '../../../shared/media/trim';
import { formatTimecode } from '../../../shared/lib/format';
import { FieldRow, RangeField, Readout } from '../../../shared/ui/Inspector';
import type { SlideMedium } from '../../../shared/roadtrip/trip-types';
import Button from '../../../shared/ui/Button';
import Segmented from '../../../shared/ui/Segmented';

/** The opener on the slide, as far as the length row needs to name it. */
export interface SlideOpener {
  /** Its name on screen — «Virée», «Itinerary», «Défilé». */
  name: string;
  /** What it occupies on its own (already fitted, when it is). */
  seconds: number;
  /** Its *Fit to the slide* setting is on. */
  fit: boolean;
}

interface SlideDeliveryProps {
  slide: DeckSlide;
  /** True when something on this slide is animated — a badge piece, today. */
  animated: boolean;
  /** The clip's length when this slide holds one and it has loaded; else 0. */
  clipSeconds: number;
  /** The open clip's stretch and speed, when the slide is a clip — the same numbers the bar under the picture edits. */
  clip?: { range: TrimRange; speed: number; onSpeed: (speed: number) => void } | null;
  onMedium: (medium: SlideMedium) => void;
  /** A length set by hand — the slide leaves Auto. */
  onSeconds: (seconds: number) => void;
  /** Back to following the opener (or the badge's life), or out of it. */
  onAuto: (auto: boolean) => void;
  /** The slide's opener, or null for none. */
  opener: SlideOpener | null;
  /** Turn the opener's *Fit to the slide* on; null when there is no opener to fit. */
  onFit: (() => void) | null;
}

const CHOICES: { id: SlideMedium; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
];

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

/**
 * The line under a choice's label, or null when the label already says it.
 *
 * `Auto` answers with the medium, which is the only thing it does not say
 * itself. The two explicit choices answer with what they would COST — settled,
 * one frame, a held card — because "Image · image" is a chip repeating its own
 * name, and a control that says nothing reads as decoration.
 */
function choiceHint(choice: SlideMedium, reason: SlideReason, medium: string): string | null {
  if (choice === 'auto') return medium;
  switch (reason) {
    case 'settled':
      return 'settled';
    case 'frozen':
      return 'one frame';
    case 'forced-video':
      return 'a held card';
    default:
      return null;
  }
}

const pill = 'inline-flex items-center h-5 px-1.5 rounded-full border font-mono text-2xs tracking-[0.04em] whitespace-nowrap';

/**
 * What this slide is delivered as, and for how long — decided HERE, where the
 * piece is composed, and never at the door.
 *
 * The maintainer's own call (2026-09-09): a deck that mixes a video hook and
 * three stills is a decision about the post, so the export reads it rather
 * than making it. Each of the three choices shows what it would really
 * deliver for THIS slide, which is the tool's standing rule — an option that
 * cannot say what it does reads as broken.
 *
 * The length wears its OWNER (2026-10-07, `slide-timing.ts`): `Auto · Virée`
 * while the slide follows its opener, `Set by you` once a grip or the slider
 * was dragged — and, when a set length cuts the opener, the cut is said right
 * here with its two verbs (back to Auto, or fit the opener), not in a red
 * sentence on another tab.
 */
export default function SlideDelivery({
  slide,
  animated,
  clipSeconds,
  clip,
  onMedium,
  onSeconds,
  onAuto,
  opener,
  onFit,
}: SlideDeliveryProps) {
  const name = slide.media?.name ?? null;
  // A clip cannot be held longer than what is left of it after its in point,
  // at its speed — and a read-out that claims 5s over a 3s clip is lying
  // about the file it will write.
  const ceiling = screenSecondsCeiling(slide.videoTimeSeconds, slide.speed, clipSeconds);
  const seconds = Math.min(slide.seconds, ceiling);
  const overflow = opener ? Math.max(0, opener.seconds - seconds) : 0;
  const cut = overflow > 0.05;
  // What Auto would give — the verb's own number, so it says what it does.
  const autoWould = Math.min(autoSeconds(opener?.seconds ?? 0, slide.seconds), ceiling);

  return (
    <>
      <FieldRow label="Goes out as" hint={reasonSentence(slide.reason, seconds, slide.speed)}>
        <Segmented
          fill
          size="sm"
          label="What this slide is delivered as"
          value={slide.chosen}
          onChange={onMedium}
          options={CHOICES.map((choice) => {
            const would = resolveSlideMedium(choice.id, animated, name);
            const hint = choiceHint(choice.id, would.reason, would.medium);
            return { id: choice.id, label: choice.label, title: hint ?? undefined };
          })}
          className="flex-1 min-w-0"
        />
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

      <FieldRow
        label="On screen"
        align="start"
        hint={
          slide.auto
            ? opener
              ? cut
                ? `Follows ${opener.name}, but the clip ends first: ${opener.name} is cut at ${seconds.toFixed(1)}s.`
                : `Follows ${opener.name}: its ${opener.seconds.toFixed(1)}s and a ${AUTO_TAIL_SECONDS}s hold. Drag the slider, or the cell’s ends on the band, to set it yourself.`
              : 'Follows the badge: its life and a beat after. Drag the slider, or the cell’s ends on the band, to set it yourself.'
            : slide.medium === 'video'
              ? clipSeconds > 0 && ceiling < MAX_HOOK_SECONDS
                ? `At most ${ceiling.toFixed(1)}s of the clip is left after its in point${slide.speed !== 1 ? ` at ${slide.speed}×` : ''}.`
                : undefined
              : 'How long this picture holds the screen when the piece plays.'
        }
      >
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <RangeField
              label="How long this slide stays on screen"
              min={MIN_HOOK_SECONDS}
              max={ceiling}
              step={0.5}
              value={seconds}
              onChange={onSeconds}
              format={(v) => `${v.toFixed(1)} s`}
            />
            <span
              className={`${pill} ${slide.auto ? 'border-accent text-accent-ink bg-accent-wash' : 'border-line-strong text-muted bg-paper'}`}
              title={slide.auto ? 'The length follows what the slide holds' : 'The length was set by hand'}
            >
              {slide.auto ? `Auto${opener ? ` · ${opener.name}` : ''}` : 'Set by you'}
            </span>
            {!slide.auto && !cut && (
              <Button size="sm" onClick={() => onAuto(true)} title={`Follow ${opener ? opener.name : 'the badge'} again: ${autoWould.toFixed(1)} s`}>
                Auto
              </Button>
            )}
          </div>
          {!slide.auto && cut && opener && (
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-xs text-accent-ink">
                {opener.name} takes {opener.seconds.toFixed(1)} s — its last {overflow.toFixed(1)} s would be cut.
                {opener.fit ? ' Fit to the slide is on and refused: the opener’s panel says why.' : ''}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={() => onAuto(true)}>
                  Use {autoWould.toFixed(1)} s
                </Button>
                {onFit && !opener.fit && (
                  <Button size="sm" onClick={onFit}>
                    Fit {opener.name} to {seconds.toFixed(1)} s
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </FieldRow>
    </>
  );
}
