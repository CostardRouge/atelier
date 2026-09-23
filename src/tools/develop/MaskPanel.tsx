import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import Button from '../../shared/ui/Button';
import { useState } from 'react';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import {
  DEFAULT_BRUSH_HARDNESS,
  DEFAULT_BRUSH_RADIUS,
  DEFAULT_COLOUR_RANGE,
  MAX_COLOUR_SAMPLES,
  defaultMask,
  describeMask,
  type Mask,
  type MaskKind,
  type MaskOp,
} from '../../shared/render/mask';
import {
  MAX_MASK_PARTS,
  PART_KINDS,
  addPart,
  componentMask,
  describePart,
  exceptCandidates,
  layerLabel,
  patchPart,
  removePart,
  withComponentMask,
  type AdjustLayer,
} from '../../shared/develop/layer';
import { isDefaultDevelop } from '../../shared/develop/develop';

const KIND_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'none', label: 'Whole' },
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'luma', label: 'Brightness' },
  { id: 'colour', label: 'Colour' },
  { id: 'brush', label: 'Painted' },
  { id: 'subject', label: 'Subject' },
];

/** A part may be any kind but a subject, and never "the whole picture". */
const PART_KIND_OPTIONS = KIND_OPTIONS.filter((o) => PART_KINDS.includes(o.id as MaskKind));

const OP_OPTIONS: readonly { id: MaskOp; label: string }[] = [
  { id: 'add', label: 'Add' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'intersect', label: 'Intersect' },
];

const COMBINE_HINT =
  'Combine a further mask with this one, the way Lightroom does. Add takes in the new shape as well (the larger of the two wherever they overlap, so a shape added to itself changes nothing); Subtract takes it out — a sky minus the mountain you paint over; Intersect keeps only where both are — the shadows, but only inside an ellipse. Parts apply in order, each one reading what the ones above it made, and each has its own invert. A subject is not offered as a part: a Subject layer can carry parts of its own, and “everything but the subject” is Except, below.';

const COLOUR_HINT =
  'Turn Pick on and tap a colour on the picture: every pixel near that colour is in the mask, wherever it is — a sky’s blue, a jacket, the green of a hillside. Tap again elsewhere to add up to five colours; tap a marker to remove it. The colour is taken from the picture as THIS layer sees it — the develop, the look and the layers below, not this layer’s own change nor anything above it — and stored, so the mask does not move when a slider does. Refine widens or narrows how far a colour may stray and still be in; lightness counts half as much as hue, so a sampled blue takes in the sky’s lighter and darker blues but not a grey of the same brightness.';

const SUBJECT_HINT =
  'A model finds the subject you tap. Turn Pick on and tap the thing you mean — a person, a car, a dog — and tap again anywhere else to add to it, which is how you take in someone AND their bag. Tapping a marker you already placed removes it. It is the whole subject the model returns, not a region you drew, so it follows an edge better than a brush and understands nothing about why you chose it: if it takes in too much, remove the point and tap somewhere more specific, or fall back to painting. “Background” is this mask inverted — the checkbox below.';

const PAINT_HINT =
  'With Paint on, a drag across the picture lays a stroke; the before/after wipe waits until it is off. Erase takes coverage away, and only from what is already there — a stroke painted after an eraser comes back, because strokes apply in the order they were made. Size and Softness are set before a stroke, not after: each stroke keeps the ones it was painted with, which is what lets a soft edge and a hard one live in the same mask.';

const HINT =
  'Feather is the width of the transition, measured against half the picture’s diagonal — so it means the same on a wide frame and on a square crop of it. A linear mask reads 0.5 exactly on its line, and its angle is a compass bearing: 0 covers the top, 90 the right. A radial mask is FULL inside its ellipse and fades outward, so the shape is what is affected rather than the middle of a ramp. Invert applies the layer everywhere the mask is not.';

/** What the painting and picking controls report about the open subject. */
export interface SubjectStatus {
  working: boolean;
  state: string;
  resolved: boolean;
}

/**
 * The selected layer's mask and opacity — its own mask, and the further masks
 * COMBINED with it (item 16), one of them open at a time.
 *
 * The procedural shapes are set with NUMBERS — dragging a gradient's line on
 * the picture needs a hit-tested overlay with its own gesture rules, which is a
 * piece of work rather than a control, and "show the mask" plus these sliders
 * already place one accurately. A PAINTED mask, a SUBJECT and a COLOUR are the
 * exceptions: there is no number that means "here" or "this blue", so they
 * take the pointer — and the pointer acts on the component OPEN here.
 *
 * The maths is `shared/render/mask.ts`.
 */
export default function MaskPanel({
  layer,
  layers,
  part,
  onPart,
  onPatch,
  brush,
  onBrush,
  painting,
  onPainting,
  subject,
}: {
  layer: AdjustLayer;
  /** The whole stack, for the subjects this layer may take out of itself. */
  layers: readonly AdjustLayer[];
  /** The component open: null is the layer's own mask, 0.. a part. */
  part: number | null;
  onPart: (part: number | null) => void;
  onPatch: (patch: Partial<Omit<AdjustLayer, 'id'>>) => void;
  /** The settings the NEXT stroke is painted with. */
  brush: { radius: number; hardness: number; erase: boolean };
  onBrush: (patch: Partial<{ radius: number; hardness: number; erase: boolean }>) => void;
  painting: boolean;
  onPainting: (on: boolean) => void;
  /** Present only for a subject mask — how its segmentation is getting on. */
  subject: SubjectStatus | null;
}) {
  const [nextOp, setNextOp] = useState<MaskOp>('add');
  const parts = layer.parts ?? [];
  const open = part !== null && parts[part] ? part : null;
  const mask = componentMask(layer, open);
  const kind: string = mask?.kind ?? 'none';
  const invert = open === null ? layer.invert : parts[open].invert;
  // The subjects this layer may SUBTRACT — «sauf le sujet», the maintainer's
  // pick (2026-09-23). Offered only where one exists: a control with nothing
  // to choose is a question the author cannot answer.
  const cuts = exceptCandidates(layers, layer.id);
  const exceptOptions = [
    { id: 'none', label: 'Nothing' },
    ...cuts.map((l) => ({ id: l.id, label: cuts.length === 1 ? 'The subject' : layerLabel(l, layers) })),
  ];

  const setMask = (next: Mask | null) => {
    if (open === null) onPatch({ mask: next });
    else if (next) onPatch({ parts: withComponentMask(layer, open, next).parts });
  };
  const setKind = (next: string) => {
    // Switching kinds STARTS the new shape fresh rather than carrying numbers
    // across: a radius is not an angle, and a half-translated shape is worse
    // than an obvious default.
    setMask(next === 'none' ? null : defaultMask(next as MaskKind));
  };
  const patchMask = (patch: Partial<Record<string, number>>) => {
    if (!mask) return;
    setMask({ ...mask, ...patch } as Mask);
  };
  const setInvert = (on: boolean) => {
    if (open === null) onPatch({ invert: on });
    else onPatch({ parts: patchPart(layer, open, { invert: on }).parts });
  };

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label={parts.length ? `Mask · ${parts.length + 1} combined` : `Mask · ${describeMask(layer.mask)}`}>
        <p>{HINT}</p>
      </SectionLegend>

      {/* The COMPONENTS, once there is more than one: the layer's own mask,
          then each part in the order it applies. A row opens it below — the
          controls, and what the stage's Pick / Paint act on. */}
      {parts.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {[null, ...parts.map((_, i) => i)].map((i) => {
            const selected = i === open;
            const label =
              i === null
                ? `${layer.invert ? 'not ' : ''}${describeMask(layer.mask)}`
                : describePart(parts[i]);
            return (
              <li
                key={i === null ? 'own' : i}
                className={`flex items-center gap-1 rounded-paper border px-1.5 py-0.5 ${
                  selected ? 'border-accent bg-surface-raised' : 'border-line'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  className="flex-1 min-w-0 truncate bg-transparent border-0 p-0 text-left font-mono text-2xs text-ink"
                  onClick={() => onPart(i)}
                >
                  {i === null ? <span className="text-faint">mask · </span> : null}
                  {label}
                </button>
                {i !== null && (
                  <IconButton
                    size="sm"
                    label={`Remove ${label}`}
                    onClick={() => {
                      onPatch({ parts: removePart(layer, i).parts });
                      onPart(null);
                    }}
                  >
                    {Icons.trash}
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open !== null && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-faint">This part</span>
          <Segmented
            size="sm"
            label="How this part combines"
            value={parts[open].op}
            onChange={(v) => onPatch({ parts: patchPart(layer, open, { op: v as MaskOp }).parts })}
            options={OP_OPTIONS}
          />
        </div>
      )}

      {/* Seven kinds do not fit one row at an inspector's width — the labels
          ran together as "Radial BrightnessPainted". `columns` is what this
          control has for a choice bigger than a row. */}
      <Segmented
        columns={open === null ? 4 : 3}
        size="sm"
        label={open === null ? 'Mask' : 'Part'}
        value={kind}
        onChange={setKind}
        options={open === null ? KIND_OPTIONS : PART_KIND_OPTIONS}
      />

      {mask && (
        <ShapeControls
          mask={mask}
          layer={layer}
          patchMask={patchMask}
          setMask={setMask}
          brush={brush}
          onBrush={onBrush}
          painting={painting}
          onPainting={onPainting}
          subject={subject}
        />
      )}

      {mask && (
        <label className="flex items-center gap-1.5 font-mono text-3xs text-faint">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
          {open === null ? 'invert — apply everywhere the mask is not' : 'invert this part before it combines'}
        </label>
      )}

      <RangeSlider
        label="Opacity"
        value={layer.opacity}
        range={{ min: 0, max: 1, step: 0.01, unit: '' }}
        reset={1}
        printed={`${Math.round(layer.opacity * 100)} %`}
        onChange={(v) => onPatch({ opacity: v })}
      />

      {cuts.length > 0 && (
        <div className="flex flex-col gap-1">
          <Segmented
            size="sm"
            label="Except"
            columns={exceptOptions.length > 3 ? 2 : undefined}
            value={layer.except && cuts.some((l) => l.id === layer.except) ? layer.except : 'none'}
            onChange={(id) => onPatch({ except: id === 'none' ? null : id })}
            options={exceptOptions}
          />
          <span className="font-mono text-3xs text-faint">
            {layer.except
              ? 'except — the subject is taken out of this layer, so its own layer alone decides it'
              : 'except — take a subject out of this layer: darken everything but the person'}
          </span>
        </div>
      )}
      {parts.length < MAX_MASK_PARTS && (
        <div className="flex flex-col gap-1">
          <SectionLegend label="Combine">
            <p>{COMBINE_HINT}</p>
          </SectionLegend>
          <Segmented size="sm" label="How the next mask combines" value={nextOp} onChange={(v) => setNextOp(v as MaskOp)} options={OP_OPTIONS} />
          <div className="flex flex-wrap items-center gap-1">
            {PART_KIND_OPTIONS.map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant="ghost"
                onClick={() => {
                  onPatch({ parts: addPart(layer, nextOp, o.id as MaskKind).parts });
                  onPart(parts.length);
                  // A colour or a painted part is made with the pointer.
                  onPainting(o.id === 'colour' || o.id === 'brush');
                }}
              >
                {nextOp === 'add' ? '+' : nextOp === 'subtract' ? '−' : '∩'} {o.label}
              </Button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

/** One mask's own controls — the same whether it is a layer's mask or a part. */
function ShapeControls({
  mask,
  layer,
  patchMask,
  setMask,
  brush,
  onBrush,
  painting,
  onPainting,
  subject,
}: {
  mask: Mask;
  layer: AdjustLayer;
  patchMask: (patch: Partial<Record<string, number>>) => void;
  setMask: (mask: Mask) => void;
  brush: { radius: number; hardness: number; erase: boolean };
  onBrush: (patch: Partial<{ radius: number; hardness: number; erase: boolean }>) => void;
  painting: boolean;
  onPainting: (on: boolean) => void;
  subject: SubjectStatus | null;
}) {
  return (
    <>
      {mask?.kind === 'linear' && (
        <>
          <RangeSlider
            label="Across"
            value={mask.x}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.5}
            printed={`${Math.round(mask.x * 100)} %`}
            onChange={(v) => patchMask({ x: v })}
          />
          <RangeSlider
            label="Down"
            value={mask.y}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.4}
            printed={`${Math.round(mask.y * 100)} %`}
            onChange={(v) => patchMask({ y: v })}
          />
          <RangeSlider
            label="Angle"
            value={mask.angle}
            range={{ min: -180, max: 180, step: 1, unit: '' }}
            reset={0}
            printed={`${Math.round(mask.angle)}°`}
            onChange={(v) => patchMask({ angle: v })}
          />
          <RangeSlider
            label="Feather"
            value={mask.feather}
            range={{ min: 0, max: 1.5, step: 0.01, unit: '' }}
            reset={0.35}
            printed={mask.feather.toFixed(2)}
            onChange={(v) => patchMask({ feather: v })}
          />
        </>
      )}

      {mask?.kind === 'radial' && (
        <>
          <RangeSlider
            label="Across"
            value={mask.x}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.5}
            printed={`${Math.round(mask.x * 100)} %`}
            onChange={(v) => patchMask({ x: v })}
          />
          <RangeSlider
            label="Down"
            value={mask.y}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.5}
            printed={`${Math.round(mask.y * 100)} %`}
            onChange={(v) => patchMask({ y: v })}
          />
          <RangeSlider
            label="Width"
            value={mask.radiusX}
            range={{ min: 0.02, max: 1.5, step: 0.01, unit: '' }}
            reset={0.4}
            printed={mask.radiusX.toFixed(2)}
            onChange={(v) => patchMask({ radiusX: v })}
          />
          <RangeSlider
            label="Height"
            value={mask.radiusY}
            range={{ min: 0.02, max: 1.5, step: 0.01, unit: '' }}
            reset={0.4}
            printed={mask.radiusY.toFixed(2)}
            onChange={(v) => patchMask({ radiusY: v })}
          />
          <RangeSlider
            label="Turn"
            value={mask.angle}
            range={{ min: -180, max: 180, step: 1, unit: '' }}
            reset={0}
            printed={`${Math.round(mask.angle)}°`}
            onChange={(v) => patchMask({ angle: v })}
          />
          <RangeSlider
            label="Feather"
            value={mask.feather}
            range={{ min: 0, max: 1.5, step: 0.01, unit: '' }}
            reset={0.3}
            printed={mask.feather.toFixed(2)}
            onChange={(v) => patchMask({ feather: v })}
          />
        </>
      )}

      {mask?.kind === 'luma' && (
        <>
          <RangeSlider
            label="From"
            value={mask.from}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0}
            printed={mask.from.toFixed(2)}
            onChange={(v) => patchMask({ from: Math.min(v, mask.to) })}
          />
          <RangeSlider
            label="To"
            value={mask.to}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.35}
            printed={mask.to.toFixed(2)}
            onChange={(v) => patchMask({ to: Math.max(v, mask.from) })}
          />
          <RangeSlider
            label="Feather"
            value={mask.feather}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.15}
            printed={mask.feather.toFixed(2)}
            onChange={(v) => patchMask({ feather: v })}
          />
        </>
      )}

      {mask?.kind === 'brush' && (
        <>
          <SectionLegend label="Painting">
            <p>{PAINT_HINT}</p>
          </SectionLegend>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant={painting ? 'primary' : 'ghost'}
              onClick={() => onPainting(!painting)}
            >
              {painting ? 'Painting' : 'Paint'}
            </Button>
            <Button
              size="sm"
              variant={brush.erase ? 'primary' : 'ghost'}
              onClick={() => onBrush({ erase: !brush.erase })}
            >
              Erase
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={!mask.strokes.length} onClick={() => setMask({ kind: 'brush', strokes: mask.strokes.slice(0, -1) })}>
              Undo stroke
            </Button>
            <Button size="sm" variant="ghost" disabled={!mask.strokes.length} onClick={() => setMask({ kind: 'brush', strokes: [] })}>
              Clear
            </Button>
          </div>
          <RangeSlider
            label="Size"
            value={brush.radius}
            range={{ min: 0.01, max: 0.8, step: 0.005, unit: '' }}
            reset={DEFAULT_BRUSH_RADIUS}
            printed={`${Math.round(brush.radius * 100)} %`}
            onChange={(v) => onBrush({ radius: v })}
          />
          <RangeSlider
            label="Softness"
            value={1 - brush.hardness}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={1 - DEFAULT_BRUSH_HARDNESS}
            printed={`${Math.round((1 - brush.hardness) * 100)} %`}
            onChange={(v) => onBrush({ hardness: 1 - v })}
          />
          {mask.strokes.length === 0 && (
            <span className="font-mono text-3xs text-faint">
              nothing painted yet — an empty painted mask covers nothing, so the layer does nothing
            </span>
          )}
        </>
      )}

      {mask?.kind === 'subject' && (
        <>
          <SectionLegend label="Subject">
            <p>{SUBJECT_HINT}</p>
          </SectionLegend>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant={painting ? 'primary' : 'ghost'}
              onClick={() => onPainting(!painting)}
            >
              {painting ? 'Picking' : 'Pick'}
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={!mask.points.length} onClick={() => setMask({ ...mask, points: [] })}>
              Clear
            </Button>
          </div>
          <span className="font-mono text-3xs text-faint">
            {subject?.state === 'unavailable'
              ? 'the model could not be loaded — every other mask still works'
              : mask.points.length === 0
                ? 'tap the subject on the picture'
                : subject?.working
                  ? `finding it… (${mask.points.length} point${mask.points.length === 1 ? '' : 's'})`
                  : subject?.resolved
                    ? `${mask.points.length} point${mask.points.length === 1 ? '' : 's'} · tap a marker to remove it${
                        // Found, and still doing nothing: said, or a subject
                        // that the model answered reads as a pick that failed.
                        isDefaultDevelop(layer.develop) ? ' · found — move a slider below to act on it' : ''
                      }`
                    : 'the model is loading — 17 MB, once per visit'}
          </span>
        </>
      )}


      {mask?.kind === 'colour' && (
        <>
          <SectionLegend label="Colour range">
            <p>{COLOUR_HINT}</p>
          </SectionLegend>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant={painting ? 'primary' : 'ghost'} onClick={() => onPainting(!painting)}>
              {painting ? 'Picking' : 'Pick'}
            </Button>
            {mask.samples.map((c, i) => (
              <button
                key={i}
                type="button"
                title="Remove this colour"
                aria-label={`Remove colour ${i + 1}`}
                className="h-5 w-5 rounded-paper border border-line"
                style={{ background: `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})` }}
                onClick={() => setMask({ ...mask, samples: mask.samples.filter((_, k) => k !== i) })}
              />
            ))}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={!mask.samples.length} onClick={() => setMask({ ...mask, samples: [] })}>
              Clear
            </Button>
          </div>
          <RangeSlider
            label="Refine"
            value={mask.range}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={DEFAULT_COLOUR_RANGE}
            printed={`${Math.round(mask.range * 100)}`}
            onChange={(v) => patchMask({ range: v })}
          />
          <span className="font-mono text-3xs text-faint">
            {mask.samples.length === 0
              ? 'tap a colour on the picture — an empty range covers nothing, so the layer does nothing'
              : mask.samples.length >= MAX_COLOUR_SAMPLES
                ? `${MAX_COLOUR_SAMPLES} colours is the most one range holds · tap a marker to remove one`
                : `${mask.samples.length} colour${mask.samples.length === 1 ? '' : 's'} · tap another to add it, a marker to remove it`}
          </span>
        </>
      )}
    </>
  );
}
