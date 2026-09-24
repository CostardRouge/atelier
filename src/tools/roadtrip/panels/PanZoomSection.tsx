import { useState } from 'react';
import { DEFAULT_STEPS, MAX_STEPS, MIN_STEPS } from '../../../shared/motion/easing';
import {
  hasMotion,
  MAX_TOUR_STOPS,
  starterMotion,
  type FramingMotion,
  type MotionPreset,
  type TourPlan,
} from '../../../shared/media/framing-motion';
import { MAX_CARDS } from '../../../shared/media/motion-cards';
import type { Framing } from '../../../shared/media/framing';
import Button from '../../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, Readout, SelectField } from '../../../shared/ui/Inspector';
import { Icons } from '../../../shared/ui/icons';
import Segmented from '../../../shared/ui/Segmented';
import { EASINGS } from '../PieceStylePanel';
import MotionCards, { type CardThumbSource } from './MotionCards';
import TourMap from './TourMap';

export interface PanZoomSectionProps {
  /** The selected picture's motion, or null while it holds still. */
  motion: FramingMotion | null;
  /** The selected picture's framing — where a motion comes to rest. */
  framing: Framing;
  /** The opener's own length on this slide; 0 where there is none to wait for. */
  openerSeconds: number;
  /** Shown beside the title — which cell of a collage this is about. */
  badge?: string;
  /** The frames the view rests on, in order, the composition last (`readCards`). */
  cards: readonly Framing[];
  /** How long it holds on each, as read back out of the keys. */
  holdSeconds: number;
  /** Where the view arrives on each card, in the slide's seconds. */
  arrivals: readonly number[];
  /** The card the stage shows and a gesture writes; null between two cards. */
  selected: number | null;
  /** The move is running on the stage. */
  playing: boolean;
  /** What the cards are drawn from; null until the picture is known. */
  thumb: CardThumbSource | null;
  onSelectCard: (index: number) => void;
  /** A card after the selected one, a touch closer, to be reframed. */
  onAddCard: () => void;
  /** The selected card off — never the last, which is the framing. */
  onRemoveCard: () => void;
  onHold: (seconds: number) => void;
  /** The curve, the steps, the start — and null to hold still, a starter to move. */
  onMotion: (motion: FramingMotion | null) => void;
  /** Play the slide from its first frame, or pause it. */
  onPlay: () => void;
  /** The one-tap moves, each with the reason it cannot be written here, if any. */
  presets: readonly { id: MotionPreset; problem: string | null }[];
  onPreset: (preset: MotionPreset) => void;
  /** The tour over the selected picture, read out of its frames; null until its shape is known. */
  tour: TourProps | null;
}

/** What the tour's map needs, and where it writes. */
export interface TourProps {
  file: File | null;
  isVideo: boolean;
  videoSeconds: number;
  /** The picture's width over its height. */
  aspect: number;
  plan: TourPlan;
  /** What each stop really shows, four corners in 0..1 of the picture. */
  windows: readonly (readonly [number, number][])[];
  onPlan: (plan: TourPlan) => void;
}

/** What each preset is called, and what it does, from the camera's side. */
const PRESET_WORDS: Record<MotionPreset, { label: string; title: string }> = {
  'pan-left': { label: 'Pan ←', title: 'The view travels left across the picture, from its right edge to its left' },
  'pan-right': { label: 'Pan →', title: 'The view travels right across the picture, from its left edge to its right' },
  'pan-up': { label: 'Pan ↑', title: 'The view travels up the picture, from its foot to its top' },
  'pan-down': { label: 'Pan ↓', title: 'The view travels down the picture, from its top to its foot' },
  'push-in': { label: 'Push in', title: 'The view starts wider and moves in on the middle of your framing' },
  'pull-out': { label: 'Pull out', title: 'The view starts close on the middle and pulls back to your framing' },
};

/**
 * Why the disabled presets are disabled, said under them — a disabled button
 * shows no tooltip, and a move refused in silence reads as a broken one.
 * One line per reason, naming the buttons it holds back.
 */
function presetHint(presets: readonly { id: MotionPreset; problem: string | null }[]): string | undefined {
  const byReason = new Map<string, string[]>();
  for (const { id, problem } of presets) {
    if (!problem) continue;
    byReason.set(problem, [...(byReason.get(problem) ?? []), PRESET_WORDS[id].label]);
  }
  if (byReason.size === 0) return undefined;
  return [...byReason].map(([reason, labels]) => `${labels.join(', ')}: ${reason}`).join(' ');
}

/**
 * The picture's pan and zoom over its slide (`framing-motion.ts`), edited as
 * CARDS (`motion-cards.ts`, `docs/picture-motion-ui.md`): a row of the frames
 * the view rests on — Start, stops, End — each a thumbnail one taps. The stage
 * then shows that card and the drag, the wheel and the pinch that already
 * frame a picture write it, and no other; a card is never placed by a gesture
 * in silence. The time between cards is not set by hand: it is shared by how
 * far each glide travels, with one pause for every card. This section holds
 * the row, the verbs on it, the pause, the quick moves, the tour's map and how
 * the picture travels.
 */
export default function PanZoomSection({
  motion,
  framing,
  openerSeconds,
  badge,
  cards,
  holdSeconds,
  arrivals,
  selected,
  playing,
  thumb,
  onSelectCard,
  onAddCard,
  onRemoveCard,
  onHold,
  onMotion,
  onPlay,
  presets,
  onPreset,
  tour,
}: PanZoomSectionProps) {
  const moving = hasMotion(motion);
  const count = cards.length;
  const [touring, setTouring] = useState(false);
  const [stop, setStop] = useState(0);
  const canRemove = moving && selected !== null && selected < count - 1;
  const cardsHint =
    count >= MAX_CARDS
      ? `${MAX_CARDS} cards at most — past that a slide is a slideshow of blurs.`
      : selected === null
        ? 'The needle is between two cards: pick one to reframe it, or add one after it.'
        : undefined;
  return (
    <InspectorSection
      id="piece.panzoom"
      title="Pan & zoom"
      badge={badge}
      info={
        <>
          <p>
            The picture moves inside its frame over the slide — slow to leave and slow to
            arrive, like a camera over a print. It comes to rest on <strong>End</strong>,
            the composition, which is also what the PNG and the grid show.
          </p>
          <p>
            Every frame it rests on is a <strong>card</strong>. Tap one: the stage shows it,
            and dragging or zooming the picture there reframes that card and no other.{' '}
            <strong>+ Stop</strong> adds a card after the one picked, a touch closer, for you
            to frame. The time between cards shares itself by how far each glide travels;{' '}
            <strong>Pause</strong> is how long the view holds on each.
          </p>
          <p>
            A <strong>quick move</strong> writes Start and End in one tap — a pan from one edge
            of the picture to the other, a push in or a pull out — over your composition,
            and plays it. A <strong>tour</strong> places stops on a map of the whole picture.
            Both are only ways of writing cards.
          </p>
          <p>
            A slide that moves leaves as a video under Auto. The zoom it reaches decides
            whether the original is fetched for the export, not the zoom it rests at.
          </p>
        </>
      }
    >
      <FieldRow label="Move">
        <Button
          size="sm"
          icon={playing ? Icons.pause : Icons.play}
          onClick={onPlay}
          disabled={!moving}
          title={playing ? 'Pause' : 'Play the slide from its first frame'}
          aria-label={playing ? 'Pause the move' : 'Play the move'}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Readout muted={!moving}>{moving ? `${count} cards` : 'Holds still'}</Readout>
        {moving && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMotion(null)}
            title="Take the move off — the picture holds still on its composition"
            className="ml-auto"
          >
            Hold still
          </Button>
        )}
      </FieldRow>
      <MotionCards
        cards={cards}
        arrivals={arrivals}
        holdSeconds={holdSeconds}
        selected={selected}
        thumb={thumb}
        onSelect={onSelectCard}
        onStart={() => onMotion(starterMotion(framing))}
      />
      {moving && (
        <FieldRow label="Cards" hint={cardsHint}>
          <Button
            size="sm"
            icon={Icons.plus}
            onClick={onAddCard}
            disabled={count >= MAX_CARDS}
            title="A card after the one picked, a touch closer — frame it on the stage"
          >
            Stop
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemoveCard}
            disabled={!canRemove}
            title={
              selected === count - 1
                ? 'End cannot go — it is the picture’s framing'
                : 'Take the picked card off'
            }
          >
            Remove
          </Button>
        </FieldRow>
      )}
      {moving && (
        <FieldRow label="Pause" hint={count < 2 ? 'A pause needs a second card.' : undefined}>
          <RangeField
            label="How long the view holds on each card"
            min={0}
            max={2}
            step={0.05}
            value={holdSeconds}
            onChange={onHold}
            format={(v) => `${v.toFixed(2)} s`}
            disabled={count < 2}
          />
        </FieldRow>
      )}
      <FieldRow label="Quick move" align="start" hint={presetHint(presets)}>
        <div className="grid grid-cols-3 gap-1.5 w-full">
          {presets.map(({ id, problem }) => (
            <Button
              key={id}
              size="sm"
              onClick={() => onPreset(id)}
              disabled={problem !== null}
              title={problem ?? PRESET_WORDS[id].title}
              className="justify-center"
            >
              {PRESET_WORDS[id].label}
            </Button>
          ))}
        </div>
      </FieldRow>
      <FieldRow label="Tour">
        <Button
          size="sm"
          variant={touring ? 'default' : 'ghost'}
          onClick={() => setTouring((open) => !open)}
          disabled={!tour}
          title={tour ? 'Visit points of the picture one after the other' : 'The picture is still being read'}
        >
          {touring ? 'Close the map' : 'Plan a tour…'}
        </Button>
        {tour && (
          <Readout muted>
            {tour.plan.stops.length} {tour.plan.stops.length === 1 ? 'stop' : 'stops'}
          </Readout>
        )}
      </FieldRow>
      {touring && tour && (
        <TourRows tour={tour} selected={Math.min(stop, tour.plan.stops.length - 1)} onSelect={setStop} />
      )}
      {moving && (
        <>
          <FieldRow label="Easing">
            <SelectField
              label="How the picture travels between cards"
              value={motion.easing}
              onChange={(easing) => onMotion({ ...motion, easing, steps: easing === 'steps' ? (motion.steps ?? DEFAULT_STEPS) : undefined })}
              options={EASINGS}
            />
          </FieldRow>
          {motion.easing === 'steps' && (
            <FieldRow label="Steps">
              <RangeField
                label="Steps between two cards"
                min={MIN_STEPS}
                max={MAX_STEPS}
                step={1}
                value={motion.steps ?? DEFAULT_STEPS}
                onChange={(steps) => onMotion({ ...motion, steps })}
                format={(v) => `${v}`}
              />
            </FieldRow>
          )}
          {openerSeconds > 0 && (
            <FieldRow label="Starts">
              <Segmented
                fill
                size="sm"
                label="When the picture starts moving"
                value={motion.start}
                onChange={(start) => onMotion({ ...motion, start })}
                options={[
                  { id: 'slide', label: 'With the slide', title: 'The move runs over the whole slide' },
                  {
                    id: 'after-opener',
                    label: 'After the opener',
                    title: `The move waits the opener’s ${openerSeconds.toFixed(1)} s — a sweep or a drive that covers the frame`,
                  },
                ]}
                className="flex-1 min-w-0"
              />
            </FieldRow>
          )}
        </>
      )}
    </InspectorSection>
  );
}

/**
 * The open tour: the map, then the zoom and the pause every stop shares, and
 * the verbs on the selected stop. Every change rewrites the whole row of
 * cards — a tour IS those cards, written at one zoom.
 */
function TourRows({ tour, selected, onSelect }: { tour: TourProps; selected: number; onSelect: (i: number) => void }) {
  const { plan, onPlan } = tour;
  const write = (patch: Partial<TourPlan>) => onPlan({ ...plan, ...patch });
  return (
    <>
      {/* The whole picture, as wide as the section: a map the width of a
          field's control column leaves stops too small to take hold of. */}
      <div className="grid gap-1.5">
        <TourMap
          file={tour.file}
          isVideo={tour.isVideo}
          videoSeconds={tour.videoSeconds}
          aspect={tour.aspect}
          stops={plan.stops}
          windows={tour.windows}
          selected={selected}
          onSelect={onSelect}
          onChange={(stops) => write({ stops })}
        />
        <p className="m-0 text-xs leading-relaxed text-muted">
          Tap the picture to add a stop ({MAX_TOUR_STOPS} at most), drag one to move it. A stop sits
          where the view can really centre at this zoom; the last is where the picture rests.
        </p>
      </div>
      <FieldRow label="Zoom">
        <RangeField
          label="The zoom every stop is seen at"
          min={1}
          max={4}
          step={0.05}
          value={plan.zoom}
          onChange={(zoom) => write({ zoom })}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </FieldRow>
      {/* A pause is written as two equal frames, so it exists only between
          stops: with one stop there is nowhere to keep it. */}
      <FieldRow label="Pause" hint={plan.stops.length < 2 ? 'Pauses start with a second stop.' : undefined}>
        <RangeField
          label="How long the view rests on each stop"
          min={0}
          max={2}
          step={0.05}
          value={plan.holdSeconds}
          onChange={(holdSeconds) => write({ holdSeconds })}
          format={(v) => `${v.toFixed(2)} s`}
          disabled={plan.stops.length < 2}
        />
      </FieldRow>
      <FieldRow label="Stop">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => write({ stops: plan.stops.filter((_, i) => i !== selected) })}
          disabled={plan.stops.length < 2}
          title={`Take off stop ${selected + 1}`}
        >
          Remove {selected + 1}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => write({ stops: plan.stops.slice(-1) })}
          disabled={plan.stops.length < 2}
          title="Keep only the last stop — the picture holds still where it rests"
        >
          Clear
        </Button>
      </FieldRow>
    </>
  );
}
