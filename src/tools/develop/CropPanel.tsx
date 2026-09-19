import { flipFraming, isDefaultFraming, wrapDegrees, type Framing } from '../../shared/media/framing';
import { describeAspect } from '../../shared/develop/crop-aspect';
import { developButtonClass } from '../../shared/develop/develop-classes';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { FieldRow, InspectorSection, RangeField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import type { CropZoneApi } from './use-crop-zone';

/** A batch verb of the Crop tab: handed this picture's crop on its click. */
export interface CropApplyVerb {
  id: string;
  label: string;
  hint?: string;
  run: (crop: { aspect: string; framing: Framing }) => void;
}

const FORMAT_OPTIONS = [
  { id: 'free', label: 'Free', title: 'Any shape — draw it on the picture, or drag the handles' },
  { id: 'original', label: 'Original', title: 'The picture’s own shape, as shot' },
  ...[...ASPECT_PRESETS].sort((a, b) => a.w / a.h - b.w / b.h).map((p) => ({ id: p.id, label: p.id, title: p.label })),
];

/**
 * The Develop tool's Crop tab. The zone itself is drawn on the stage
 * (`CropStage`); here are its FORMAT (Free, the picture's own, the suite's
 * named aspects — choosing one keeps the zone's centre and takes the largest
 * zone of that shape that fits there), the turn and the flips.
 *
 * What D8 had and this has not: Zoom (the zone's size IS the zoom), the Shape
 * slider (a handle is the shape) and Fit — Whole was a way to see the whole
 * picture, which the stage now always shows; the bars it made are the
 * Borders' job.
 */
export default function CropPanel({
  crop,
  aspect,
  verbs = [],
  onTold,
}: {
  crop: CropZoneApi;
  aspect: string;
  verbs?: readonly CropApplyVerb[];
  onTold?: (message: string) => void;
}) {
  const { framing, zone } = crop;
  const touched = !isDefaultFraming(framing) || aspect !== 'original';
  return (
    <>
      <InspectorSection
        id="develop.crop"
        title="Crop"
        info={
          <>
            <p>
              The whole picture stays on the stage; what the crop cuts away is darkened. Drag inside the
              zone to move it, on the picture to draw a new one, a handle to move that edge or corner —
              the opposite one stays put. Double-click for the largest zone of the format; the arrow
              keys nudge it once the stage has been touched (Shift for ten).
            </p>
            <p>
              <strong>Free</strong> is any shape, Shift holding the one you have. A named format holds
              its shape from the opposite corner; <strong>X</strong> or the turn button swaps portrait
              and landscape.
            </p>
            <p>The flips mirror what the frame shows, whatever the picture’s rotation.</p>
          </>
        }
        actions={
          touched ? (
            <Button size="sm" variant="ghost" onClick={crop.reset}>
              Reset
            </Button>
          ) : undefined
        }
      >
        <FieldRow label="Format">
          <Segmented
            fill
            columns={3}
            size="sm"
            label="Format"
            value={crop.chip}
            onChange={crop.setChip}
            options={FORMAT_OPTIONS}
            className="flex-1 min-w-0"
          />
        </FieldRow>
        <FieldRow label="Shape">
          <span className="flex-1 font-mono text-xs tabular-nums text-ink-soft">
            {zone ? describeAspect(zone.w / zone.h) : '—'}
            {crop.lock === null && <span className="text-faint"> · free</span>}
          </span>
          <IconButton size="sm" label="Swap portrait and landscape (X)" onClick={crop.swap}>
            {Icons.swap}
          </IconButton>
        </FieldRow>
        <FieldRow label="Rotation">
          <RangeField
            label="Rotation"
            min={-180}
            max={180}
            step={0.5}
            value={framing.rotation}
            onChange={(rotation) => crop.setFraming({ ...framing, rotation })}
            format={(v) => `${Math.round(v)}°`}
          />
        </FieldRow>
        <FieldRow label="Turn">
          <Button
            size="sm"
            onClick={() => crop.setFraming({ ...framing, rotation: wrapDegrees(framing.rotation - 90) })}
            title="Turn a quarter anticlockwise"
          >
            −90°
          </Button>
          <Button
            size="sm"
            onClick={() => crop.setFraming({ ...framing, rotation: wrapDegrees(framing.rotation + 90) })}
            title="Turn a quarter clockwise"
          >
            +90°
          </Button>
        </FieldRow>
        <FieldRow label="Flip">
          <Button size="sm" icon={Icons.flipHorizontal} onClick={() => crop.setFraming(flipFraming(framing, 'x'))} title="Mirror the picture left to right">
            Horizontal
          </Button>
          <Button size="sm" icon={Icons.flipVertical} onClick={() => crop.setFraming(flipFraming(framing, 'y'))} title="Mirror the picture top to bottom">
            Vertical
          </Button>
        </FieldRow>
      </InspectorSection>
      {verbs.length > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t border-line">
          <SectionLegend label="Apply crop to…">
            <p>
              This format, zone, rotation and flips written onto other pictures, now, each as its own copy.
              A zone that would fall off a picture of another shape is held at its edge.
            </p>
          </SectionLegend>
          {verbs.map((verb) => (
            <div key={verb.id} className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={() => {
                  verb.run({ aspect, framing: { ...framing } });
                  onTold?.(`done · ${verb.label.toLowerCase()}`);
                }}
                className={developButtonClass}
              >
                {verb.label}
              </button>
              {verb.hint && <span className="font-mono text-3xs text-faint leading-relaxed">{verb.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
