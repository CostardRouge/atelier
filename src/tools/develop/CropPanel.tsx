import {
  DEFAULT_FRAMING,
  MAX_FRAMING_SCALE,
  flipFraming,
  isDefaultFraming,
  wrapDegrees,
  type Framing,
} from '../../shared/media/framing';
import { developButtonClass } from '../../shared/develop/develop-classes';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import Button from '../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';

/** A batch verb of the Crop tab: handed this picture's crop on its click. */
export interface CropApplyVerb {
  id: string;
  label: string;
  hint?: string;
  run: (crop: { aspect: string; framing: Framing }) => void;
}

const ASPECT_OPTIONS = [
  { id: 'original', label: 'Original', title: 'The picture’s own shape, as shot' },
  ...[...ASPECT_PRESETS].sort((a, b) => a.w / a.h - b.w / b.h).map((p) => ({ id: p.id, label: p.id, title: p.label })),
];

/**
 * The Develop tool's Crop tab: aspect, fit, zoom, rotation and the flips — the
 * same fields Trips' Picture tab draws over `FramingStage` there, so a
 * photographer moving between the two finds the same controls under the same
 * names. Reset keeps the chosen fit, exactly as Trips' does: asking for the
 * whole picture is not a crop to undo.
 */
export default function CropPanel({
  framing,
  aspect,
  onFraming,
  onAspect,
  verbs = [],
  onTold,
}: {
  framing: Framing;
  aspect: string;
  onFraming: (framing: Framing) => void;
  onAspect: (aspect: string) => void;
  verbs?: readonly CropApplyVerb[];
  onTold?: (message: string) => void;
}) {
  return (
    <>
    <InspectorSection
      id="develop.crop"
      title="Crop"
      info={
        <>
          <p>
            Where the picture sits inside its aspect. Drag it on the stage to move it, the wheel
            (or a trackpad pinch) to zoom.
          </p>
          <p>
            <strong>Fill</strong> covers the frame and crops what does not fit: it can never be
            zoomed out past covering or dragged off an edge. <strong>Whole</strong> shows all of
            the picture with black bars where it falls short of the frame.
          </p>
          <p>The flips mirror what the frame shows, whatever the picture’s rotation.</p>
        </>
      }
      actions={
        isDefaultFraming({ ...framing, fit: 'cover' }) ? undefined : (
          <Button size="sm" variant="ghost" onClick={() => onFraming({ ...DEFAULT_FRAMING, fit: framing.fit })}>
            Reset
          </Button>
        )
      }
    >
      <FieldRow label="Aspect">
        <Segmented
          fill
          columns={3}
          size="sm"
          label="Aspect"
          value={aspect}
          onChange={onAspect}
          options={ASPECT_OPTIONS}
          className="flex-1 min-w-0"
        />
      </FieldRow>
      <FieldRow label="Fit">
        <Segmented
          fill
          size="sm"
          label="Fit"
          value={framing.fit}
          // A new fit starts centred at its own scale 1: a zoom and a pan
          // chosen to crop mean something else once the bars are allowed.
          onChange={(fit) => {
            if (fit !== framing.fit) onFraming({ ...framing, fit, scale: 1, x: 0, y: 0 });
          }}
          options={[
            { id: 'cover', label: 'Fill', title: 'Cover the frame; the excess is cropped' },
            { id: 'contain', label: 'Whole', title: 'Show the whole picture, with black bars where it falls short' },
          ]}
          className="flex-1 min-w-0"
        />
      </FieldRow>
      <FieldRow label="Zoom">
        <RangeField
          label="Zoom"
          min={1}
          max={MAX_FRAMING_SCALE}
          step={0.01}
          value={framing.scale}
          onChange={(scale) => onFraming({ ...framing, scale })}
          format={(v) => `${v.toFixed(2)}×`}
        />
      </FieldRow>
      <FieldRow label="Rotation">
        <RangeField
          label="Rotation"
          min={-180}
          max={180}
          step={0.5}
          value={framing.rotation}
          onChange={(rotation) => onFraming({ ...framing, rotation })}
          format={(v) => `${Math.round(v)}°`}
        />
      </FieldRow>
      <FieldRow label="Turn">
        <Button size="sm" onClick={() => onFraming({ ...framing, rotation: wrapDegrees(framing.rotation - 90) })} title="Turn a quarter anticlockwise">
          −90°
        </Button>
        <Button size="sm" onClick={() => onFraming({ ...framing, rotation: wrapDegrees(framing.rotation + 90) })} title="Turn a quarter clockwise">
          +90°
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onFraming({ ...framing, rotation: 0 })} disabled={framing.rotation === 0}>
          Straight
        </Button>
      </FieldRow>
      <FieldRow label="Flip">
        <Button size="sm" icon={Icons.flipHorizontal} onClick={() => onFraming(flipFraming(framing, 'x'))} title="Mirror the picture left to right">
          Horizontal
        </Button>
        <Button size="sm" icon={Icons.flipVertical} onClick={() => onFraming(flipFraming(framing, 'y'))} title="Mirror the picture top to bottom">
          Vertical
        </Button>
      </FieldRow>
    </InspectorSection>
    {verbs.length > 0 && (
      <div className="flex flex-col gap-2 pt-3 border-t border-line">
        <SectionLegend label="Apply to…">
          <p>
            This aspect, fit, zoom, rotation, flips and position written onto other pictures, now,
            each as its own copy. A position that would open a gap on a picture of another shape is
            held at its edge.
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
