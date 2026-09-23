import { DEFAULT_STEPS, MAX_STEPS, MIN_STEPS } from '../../../shared/motion/easing';
import { hasMotion, keepEnds, starterMotion, type FramingMotion } from '../../../shared/media/framing-motion';
import type { Framing } from '../../../shared/media/framing';
import Button from '../../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, Readout, SelectField, ToggleField } from '../../../shared/ui/Inspector';
import Segmented from '../../../shared/ui/Segmented';
import { EASINGS } from '../PieceStylePanel';

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
}: PanZoomSectionProps) {
  const moving = hasMotion(motion);
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
