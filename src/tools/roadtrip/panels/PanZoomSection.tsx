import { useState } from 'react';
import { DEFAULT_STEPS, MAX_STEPS, MIN_STEPS } from '../../../shared/motion/easing';
import {
  hasMotion,
  keepEnds,
  MAX_TOUR_STOPS,
  starterMotion,
  type FramingMotion,
  type MotionPreset,
  type TourPlan,
} from '../../../shared/media/framing-motion';
import type { Framing } from '../../../shared/media/framing';
import Button from '../../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, Readout, SelectField, ToggleField } from '../../../shared/ui/Inspector';
import Segmented from '../../../shared/ui/Segmented';
import { EASINGS } from '../PieceStylePanel';
import TourMap from './TourMap';

/** Where the needle sends the arrows: the first frame, a neighbour, the rest. */
export type NeedleJump = 'first' | 'prev' | 'next' | 'rest';

export interface PanZoomSectionProps {
  /** The selected picture's motion, or null while it holds still. */
  motion: FramingMotion | null;
  /** The selected picture's framing — where a motion comes to rest. */
  framing: Framing;
  /** What a gesture on the stage writes, said as the author reads it. */
  placing: string;
  /** The needle sits on a frame that can be taken off (not the rest). */
  canRemove: boolean;
  /** The opener's own length on this slide; 0 where there is none to wait for. */
  openerSeconds: number;
  /** Shown beside the title — which cell of a collage this is about. */
  badge?: string;
  onMotion: (motion: FramingMotion | null) => void;
  onRemove: () => void;
  onJump: (to: NeedleJump) => void;
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
 * The picture's pan and zoom over its slide (`framing-motion.ts`), edited AT
 * THE NEEDLE: the stage's own gesture — a drag, the wheel, a pinch — writes
 * the frame the needle is on, so there is no second editor to learn. This
 * section only turns the motion on, says what the gesture will write, moves
 * the needle between the placed frames and sets how the picture travels.
 */
export default function PanZoomSection({
  motion,
  framing,
  placing,
  canRemove,
  openerSeconds,
  badge,
  onMotion,
  onRemove,
  onJump,
  presets,
  onPreset,
  tour,
}: PanZoomSectionProps) {
  const moving = hasMotion(motion);
  const [touring, setTouring] = useState(false);
  const [stop, setStop] = useState(0);
  return (
    <InspectorSection
      id="piece.panzoom"
      title="Pan & zoom"
      badge={badge}
      info={
        <>
          <p>
            The picture moves inside its frame over the slide — slow to leave and slow to
            arrive, like a camera over a print. It comes to rest on the framing above,
            which is also what the PNG and the grid show.
          </p>
          <p>
            Place it <strong>at the needle</strong>: stop the band where you want a frame,
            then drag and zoom the picture on the stage as you always do. At the start of
            the slide you are setting the rest (the composition); anywhere inside it you
            set the frame the needle is on, or add one. A frame placed twice with nothing
            changed is a pause.
          </p>
          <p>
            A <strong>quick move</strong> writes a whole move in one tap — a pan from one edge
            of the picture to the other, a push in or a pull out — over your framing. It
            replaces the frames placed so far and keeps the easing; refine it at the needle.
          </p>
          <p>
            A <strong>tour</strong> visits points of the picture in order: open the map of the
            whole picture, tap where the view should go, drag a stop to move it. Every stop is
            seen at one zoom and held for the pause you set; the glides share the rest of the
            slide by how far they travel, and the last stop is where the picture rests.
          </p>
          <p>
            A slide that moves leaves as a video under Auto. The zoom it reaches decides
            whether the original is fetched for the export, not the zoom it rests at.
          </p>
        </>
      }
    >
      <FieldRow label="Moves">
        <ToggleField
          label="The picture moves over the slide"
          checked={moving}
          onChange={(on) => onMotion(on ? starterMotion(framing) : null)}
        >
          {moving ? `${motion.keys.length + 1} frames` : 'Holds still'}
        </ToggleField>
      </FieldRow>
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
          <FieldRow label="Placing" hint="A drag or a zoom on the stage writes this frame.">
            <Readout>{placing}</Readout>
          </FieldRow>
          <FieldRow label="Needle">
            <Button size="sm" onClick={() => onJump('first')} title="Put the needle on the first frame">
              First
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onJump('prev')} title="The frame before the needle">
              ‹
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onJump('next')} title="The frame after the needle">
              ›
            </Button>
            <Button size="sm" onClick={() => onJump('rest')} title="Put the needle where the picture comes to rest">
              Rest
            </Button>
          </FieldRow>
          <FieldRow label="Frames">
            <Button
              size="sm"
              variant="ghost"
              onClick={onRemove}
              disabled={!canRemove}
              title="Take off the frame the needle is on — the rest stays, it is the framing"
            >
              Remove
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMotion(keepEnds(motion))}
              disabled={motion.keys.length < 2}
              title="Keep the first frame and the rest, drop every frame between them"
            >
              Keep ends
            </Button>
          </FieldRow>
          <FieldRow label="Easing">
            <SelectField
              label="How the picture travels between frames"
              value={motion.easing}
              onChange={(easing) => onMotion({ ...motion, easing, steps: easing === 'steps' ? (motion.steps ?? DEFAULT_STEPS) : undefined })}
              options={EASINGS}
            />
          </FieldRow>
          {motion.easing === 'steps' && (
            <FieldRow label="Steps">
              <RangeField
                label="Steps between two frames"
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
 * the verbs on the selected stop. Every change rewrites the whole tour — the
 * frames placed at the needle included, since a tour IS those frames.
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
