import { isDefaultFraming, type Framing } from '../../shared/media/framing';
import { splitRotation } from '../../shared/develop/crop-rect';
import { describeAspect } from '../../shared/develop/crop-aspect';
import { developButtonClass } from '../../shared/develop/develop-classes';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { FieldRow, InspectorSection, RangeField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import type { RollBorder } from '../../shared/develop/border-layout';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import BorderSection, { type BorderApplyVerb } from './BorderSection';
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
  picture,
  crop,
  aspect,
  border,
  onBorder,
  deliveredSize,
  verbs = [],
  borderVerbs = [],
  onTold,
}: {
  picture: DevelopPicture;
  crop: CropZoneApi;
  aspect: string;
  border: RollBorder | null;
  onBorder: (border: RollBorder | null) => void;
  deliveredSize: { w: number; h: number } | null;
  verbs?: readonly CropApplyVerb[];
  borderVerbs?: readonly BorderApplyVerb[];
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
              <strong>Free</strong> is any shape, Shift holding the one you have — and where a picture
              nobody has cropped yet opens, so the first drag needs no click first. A named format holds
              its shape from the opposite corner; <strong>X</strong> or the turn button swaps portrait
              and landscape.
            </p>
            <p>
              <strong>Straighten</strong> turns the picture under the zone, which shrinks just enough to
              keep clear of the corners — and grows back to what you drew when you straighten back.
              <strong> Level</strong>: draw a line along the horizon (or an upright) and the angle is
              corrected by it. The quarter turns take the zone with the picture.
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
        <FieldRow label="Straighten">
          <RangeField
            label="Straighten"
            min={-45}
            max={45}
            step={0.1}
            value={splitRotation(framing.rotation).fine}
            onChange={crop.straighten}
            format={(v) => `${v.toFixed(1)}°`}
          />
        </FieldRow>
        <FieldRow label="Level">
          <Button
            size="sm"
            variant={crop.levelling ? 'primary' : 'default'}
            aria-pressed={crop.levelling}
            onClick={() => crop.setLevelling(!crop.levelling)}
            title="Draw a line along the horizon, or along something that should stand upright"
          >
            {crop.levelling ? 'Draw the line…' : 'Level'}
          </Button>
          {splitRotation(framing.rotation).fine !== 0 && (
            <Button size="sm" variant="ghost" onClick={() => crop.straighten(0)}>
              Straight
            </Button>
          )}
        </FieldRow>
        <FieldRow label="Turn">
          <Button size="sm" onClick={() => crop.quarterTurn(-1)} title="Turn a quarter anticlockwise">
            −90°
          </Button>
          <Button size="sm" onClick={() => crop.quarterTurn(1)} title="Turn a quarter clockwise">
            +90°
          </Button>
        </FieldRow>
        <FieldRow label="Flip">
          <Button size="sm" icon={Icons.flipHorizontal} onClick={() => crop.flip('x')} title="Mirror the picture left to right">
            Horizontal
          </Button>
          <Button size="sm" icon={Icons.flipVertical} onClick={() => crop.flip('y')} title="Mirror the picture top to bottom">
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
      <BorderSection
        picture={picture}
        crop={crop}
        border={border}
        onBorder={onBorder}
        deliveredSize={deliveredSize}
        verbs={borderVerbs}
        onTold={onTold}
      />
    </>
  );
}
