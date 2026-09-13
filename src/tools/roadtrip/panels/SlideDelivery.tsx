import SectionLegend from '../../../shared/ui/SectionLegend';
import {
  resolveSlideMedium,
  type DeckSlide,
  type SlideReason,
} from '../../../shared/roadtrip/deck';
import {
  MAX_HOOK_SECONDS,
  MIN_HOOK_SECONDS,
  screenSecondsCeiling,
} from '../../../shared/roadtrip/hook-video';
import type { SlideMedium } from '../../../shared/roadtrip/trip-types';
import { chipClass, legend } from './ui';

interface SlideDeliveryProps {
  slide: DeckSlide;
  /** True when something on this slide is animated — a badge piece, today. */
  animated: boolean;
  /** The clip's length when this slide holds one and it has loaded; else 0. */
  clipSeconds: number;
  onMedium: (medium: SlideMedium) => void;
  onSeconds: (seconds: number) => void;
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

/** One word for a row in the rail or a plan: what this slide delivers. */
function shortAnswer(reason: SlideReason): string {
  switch (reason) {
    case 'animated':
      return 'video · it animates';
    case 'moving':
      return 'video · it is a clip';
    case 'forced-video':
      return 'video · a held card';
    case 'settled':
      return 'image · settled';
    case 'frozen':
      return 'image · one frame';
    case 'plain':
      return 'image';
  }
}

/**
 * What this slide is delivered as, and for how long — decided HERE, where the
 * piece is composed, and never at the door.
 *
 * The maintainer's own call (2026-09-09): a deck that mixes a video hook and
 * three stills is a decision about the post, so the export reads it rather
 * than making it. Each of the three choices shows what it would really
 * deliver for THIS slide, which is the tool's standing rule — an option that
 * cannot say what it does reads as broken.
 */
export default function SlideDelivery({
  slide,
  animated,
  clipSeconds,
  onMedium,
  onSeconds,
}: SlideDeliveryProps) {
  const name = slide.media?.name ?? null;
  // A clip cannot be held longer than what is left of it after its in point,
  // at its speed — and a read-out that claims 5s over a 3s clip is lying
  // about the file it will write.
  const ceiling = screenSecondsCeiling(slide.videoTimeSeconds, slide.speed, clipSeconds);
  const seconds = Math.min(slide.seconds, ceiling);

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label={`This slide · ${shortAnswer(slide.reason)}`}>
        <p>
          A slide goes out as a video when something on it moves — an animated badge,
          a clip — and as an image otherwise. Say so explicitly when you want the
          other one: a still of an animated hook is how a piece gets its grid
          picture, and a photograph held for a few seconds is how it opens a reel.
        </p>
      </SectionLegend>

      <div className="grid grid-cols-3 gap-1">
        {CHOICES.map((choice) => {
          const would = resolveSlideMedium(choice.id, animated, name);
          const hint = choiceHint(choice.id, would.reason, would.medium);
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => onMedium(choice.id)}
              aria-pressed={slide.chosen === choice.id}
              className={`${chipClass(slide.chosen === choice.id)} flex flex-col gap-0.5 !text-left`}
            >
              <span className="font-semibold">{choice.label}</span>
              <span className="font-mono text-[0.6rem] tracking-[0.06em] uppercase opacity-70">
                {hint ?? ' '}
              </span>
            </button>
          );
        })}
      </div>

      <p className="m-0 text-[0.76rem] text-ink-soft">
        {reasonSentence(slide.reason, seconds, slide.speed)}
      </p>

      <label className="flex flex-col gap-1">
        <span className={legend}>
          On screen · {seconds.toFixed(1)}s
          {clipSeconds > 0 && ceiling < MAX_HOOK_SECONDS
            ? ` of ${ceiling.toFixed(1)}s left${slide.speed !== 1 ? ` at ${slide.speed}×` : ''}`
            : ''}
        </span>
        <input
          type="range"
          min={MIN_HOOK_SECONDS}
          max={ceiling}
          step={0.5}
          value={seconds}
          onChange={(e) => onSeconds(Number(e.target.value))}
          className="accent-accent"
          aria-label="How long this slide stays on screen"
        />
        <span className="text-[0.72rem] text-muted">
          {slide.medium === 'video'
            ? clipSeconds > 0
              ? 'The length of the clip this slide delivers — the out point on the bar under the picture, where the in point and the speed are cut too.'
              : 'The length of the clip this slide delivers.'
            : 'An image ignores this, until the deck is combined into one reel.'}
        </span>
      </label>
    </div>
  );
}
