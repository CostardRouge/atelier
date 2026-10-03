import { isDefaultFraming, type Framing } from '../../shared/media/framing';
import { LEVEL_SAMPLE_EDGE, describeTilt, levelFine, lumaOf, measureTilt } from '../../shared/develop/auto-level';
import { splitRotation } from '../../shared/develop/crop-rect';
import { describeAspect } from '../../shared/develop/crop-aspect';
import { developButtonClass } from '../../shared/develop/develop-classes';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { FieldRow, RangeField } from '../../shared/ui/Inspector';
import DevelopFold from '../../shared/develop/DevelopFold';
import { Icons } from '../../shared/ui/icons';
import Segmented from '../../shared/ui/Segmented';
import type { RollBorder } from '../../shared/develop/border-layout';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import BorderSection, { type BorderApplyVerb } from './BorderSection';
import type { CropZoneApi } from './use-crop-zone';
import type { SubjectCropVerb } from './use-subject-crop';
import type { CropSwitches } from './use-crop-switches';
import AutoSwitch from '../../shared/develop/AutoSwitch';

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
  clip = false,
  subjectCrop,
  switches,
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
  /** A CLIP: the crop is held still over every frame, and it wears no border (`roll-types.ts`, `isClipPicture`). */
  clip?: boolean;
  /** Crop to the subject (`use-subject-crop.ts`); omitted, the row is not drawn. */
  subjectCrop?: SubjectCropVerb;
  /** Auto level and Crop to subject as switches (`use-crop-switches.ts`); omitted, they only apply. */
  switches?: CropSwitches;
  onTold?: (message: string) => void;
}) {
  const { framing, zone } = crop;
  const touched = !isDefaultFraming(framing) || aspect !== 'original';
  // Auto level: the picture as shot, read whole and once, on the click.
  const autoLevel = () => {
    const sample = picture.asShotSample(LEVEL_SAMPLE_EDGE);
    const ctx = sample?.getContext('2d', { willReadFrequently: true });
    if (!sample || !ctx) {
      onTold?.('the picture has not been read yet');
      return;
    }
    const tilt = measureTilt(lumaOf(ctx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height));
    const write = () => {
      if (tilt && tilt.tilt !== 0) crop.straighten(levelFine(tilt, framing.flipX, framing.flipY));
    };
    if (switches) switches.record('level', write);
    else write();
    onTold?.(`auto level · ${describeTilt(tilt)}`);
  };
  const levelState = switches?.state('level') ?? 'off';
  const subjectState = switches?.state('subject') ?? 'off';
  return (
    <>
      <DevelopFold
        id="crop"
        title="Crop"
        marked={touched}
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
              corrected by it. <strong>Auto</strong> finds that line by itself — the strongest straight
              edge within 15° of level, a horizon or a wall — and says when the picture holds none it can
              trust. The quarter turns take the zone with the picture.
            </p>
            <p>
              <strong>Crop to subject</strong> draws the zone around the subject — what your Subject
              layers point at, else what the model finds at the centre, and the line says which — with
              room around it, in the format chosen above, slid inside the picture rather than shrunk;
              a speck and a subject that is the whole picture are refused with the reason.
            </p>
            <p>The flips mirror what the frame shows, whatever the picture’s rotation.</p>
            {clip && (
              <p>
                On a clip the crop is ONE zone held still over every frame — play the clip under it to
                judge it on the frames that matter; it never follows the picture.
              </p>
            )}
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
          <AutoSwitch
            shape="control"
            state={levelState}
            onClick={() => {
              if (!switches?.turnOff('level')) autoLevel();
            }}
            disabled={!picture.source && levelState === 'off'}
            hint="Find the horizon, or an upright, by itself — the strongest line near level — and straighten on it"
          >
            Auto
          </AutoSwitch>
          {splitRotation(framing.rotation).fine !== 0 && (
            <Button size="sm" variant="ghost" onClick={() => crop.straighten(0)}>
              Straight
            </Button>
          )}
        </FieldRow>
        {subjectCrop && (
          <FieldRow
            label="Subject"
            hint={
              subjectCrop.named
                ? 'The subject is what your Subject layers point at.'
                : 'No subject picked: the model is asked what sits at the centre. Pick one on the Layers tab for another.'
            }
          >
            <AutoSwitch
              shape="control"
              state={subjectCrop.busy ? 'off' : subjectState}
              // The verb lasts as long as the model takes to answer: its promise.
              onClick={() => (switches?.turnOff('subject') ? undefined : subjectCrop.run())}
              disabled={(!picture.source && subjectState === 'off') || subjectCrop.busy}
              hint={
                subjectCrop.named
                  ? 'Crop around what your Subject layers point at, in the format chosen above'
                  : 'Crop around what the model finds at the centre of the picture, in the format chosen above'
              }
            >
              {subjectCrop.busy ? 'Finding…' : 'Crop to subject'}
            </AutoSwitch>
            <span className="font-mono text-3xs text-faint leading-relaxed">
              {subjectCrop.named ? 'from your Subject layers' : 'from the centre'}
            </span>
          </FieldRow>
        )}
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
      </DevelopFold>
      {verbs.length > 0 && (
        <DevelopFold
          id="crop-apply"
          title="Apply crop to…"
          defaultOpen={false}
          info={
            <p>
              This format, zone, rotation and flips written onto other pictures, now, each as its own copy.
              A zone that would fall off a picture of another shape is held at its edge.
            </p>
          }
        >
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
        </DevelopFold>
      )}
      {!clip && (
        <BorderSection
          picture={picture}
          crop={crop}
          border={border}
          onBorder={onBorder}
          deliveredSize={deliveredSize}
          verbs={borderVerbs}
          onTold={onTold}
        />
      )}
    </>
  );
}
