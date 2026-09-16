import { STAGGER_ORDERS, newStaggerSeed } from '../../../shared/overlay/stagger';
import {
  defaultCollageEnter,
  defaultCollageExit,
  mirroredExit,
  type SlideCollage,
} from '../../../shared/roadtrip/collage';
import Button from '../../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, SelectField, ToggleField } from '../../../shared/ui/Inspector';
import { StepRows } from '../PieceStylePanel';

interface CollageMotionSectionProps {
  collage: SlideCollage;
  /** The slide's screen time — what the exit is laid against. */
  seconds: number;
  onChange: (collage: SlideCollage) => void;
}

/**
 * How a collage's cells arrive and leave: one entrance shared by every cell,
 * spread by an order (centre out, rows, the big one first…), and an exit laid
 * against the slide's screen time. Any of it makes the slide a video; none of
 * it leaves it a still.
 */
export default function CollageMotionSection({ collage, seconds, onChange }: CollageMotionSectionProps) {
  const enter = collage.enter ?? null;
  const exit = collage.exit ?? null;
  const moves = Boolean(enter || exit);

  return (
    <InspectorSection
      id="piece.collage-motion"
      title="Motion"
      badge={moves ? 'video' : undefined}
      info={
        <>
          <p>
            One entrance shared by every cell, the cells arriving one rank after another in the
            order chosen — from the centre, row by row, the biggest first, shuffled once with a
            seed that is kept. <strong>Inside</strong> moves the picture behind its cell rather
            than the cell itself, so the grid stays still while the pictures arrive in it.
          </p>
          <p>
            An exit is laid against the slide’s {seconds.toFixed(1)} s on screen; the cells leave
            in reverse or in arrival order. A collage that moves is delivered as a video; a still
            of it is taken once the last cell has landed.
          </p>
        </>
      }
    >
      <FieldRow label="Arrive">
        <ToggleField
          label="The cells arrive"
          checked={Boolean(enter)}
          onChange={(on) => onChange({ ...collage, enter: on ? defaultCollageEnter() : null })}
        />
      </FieldRow>
      {enter && (
        <>
          <StepRows
            which="In"
            step={enter.step}
            hideDelay
            onChange={(step) =>
              onChange({
                ...collage,
                enter: { ...enter, step: step ?? { preset: 'none', duration: 0, easing: 'linear' } },
              })
            }
          />
          {(enter.step.preset === 'slide' || enter.step.preset === 'scale') && (
            <FieldRow label="Inside">
              <ToggleField
                label="Move the picture inside its cell"
                checked={Boolean(enter.step.inside)}
                onChange={(inside) => onChange({ ...collage, enter: { ...enter, step: { ...enter.step, inside } } })}
              />
            </FieldRow>
          )}
          <FieldRow label="Order">
            <SelectField
              label="Arrival order"
              value={enter.stagger.order}
              onChange={(order) =>
                onChange({
                  ...collage,
                  enter: {
                    ...enter,
                    stagger: {
                      ...enter.stagger,
                      order,
                      ...(order === 'random' && enter.stagger.seed === undefined ? { seed: newStaggerSeed() } : {}),
                    },
                  },
                })
              }
              options={STAGGER_ORDERS.map((o) => ({ id: o.id, label: `${o.label} — ${o.hint}` }))}
            />
          </FieldRow>
          <FieldRow label="Each">
            <RangeField
              label="Seconds between two ranks"
              min={0}
              max={0.6}
              step={0.01}
              value={enter.stagger.each}
              onChange={(each) => onChange({ ...collage, enter: { ...enter, stagger: { ...enter.stagger, each } } })}
              format={(v) => `${v.toFixed(2)} s`}
            />
          </FieldRow>
          {enter.stagger.order === 'random' && (
            <FieldRow label="Shuffle">
              <Button
                size="sm"
                onClick={() =>
                  onChange({ ...collage, enter: { ...enter, stagger: { ...enter.stagger, seed: newStaggerSeed() } } })
                }
              >
                Shuffle again
              </Button>
            </FieldRow>
          )}
        </>
      )}

      <FieldRow label="Leave">
        <ToggleField
          label="The cells leave"
          checked={Boolean(exit)}
          onChange={(on) => onChange({ ...collage, exit: on ? (enter ? mirroredExit(enter) : defaultCollageExit()) : null })}
        />
        {exit && enter && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...collage, exit: mirroredExit(enter) })}>
            Mirror the entrance
          </Button>
        )}
      </FieldRow>
      {exit && (
        <>
          <StepRows
            which="Out"
            step={exit.step}
            onChange={(step) =>
              onChange({
                ...collage,
                exit: { ...exit, step: step ?? { preset: 'none', duration: 0, easing: 'linear' } },
              })
            }
          />
          <FieldRow label="Order">
            <ToggleField
              label="Leave in reverse order"
              checked={exit.reverse}
              onChange={(reverse) => onChange({ ...collage, exit: { ...exit, reverse } })}
            />
          </FieldRow>
        </>
      )}
    </InspectorSection>
  );
}
