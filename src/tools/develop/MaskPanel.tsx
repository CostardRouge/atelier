import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import Button from '../../shared/ui/Button';
import {
  DEFAULT_BRUSH_HARDNESS,
  DEFAULT_BRUSH_RADIUS,
  defaultMask,
  describeMask,
  type Mask,
  type MaskKind,
} from '../../shared/render/mask';
import { exceptCandidates, layerLabel, type AdjustLayer } from '../../shared/develop/layer';
import { isDefaultDevelop } from '../../shared/develop/develop';

const KIND_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'none', label: 'Whole' },
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'luma', label: 'Brightness' },
  { id: 'brush', label: 'Painted' },
  { id: 'subject', label: 'Subject' },
];

const SUBJECT_HINT =
  'A model finds the subject you tap. Turn Pick on and tap the thing you mean — a person, a car, a dog — and tap again anywhere else to add to it, which is how you take in someone AND their bag. Tapping a marker you already placed removes it. It is the whole subject the model returns, not a region you drew, so it follows an edge better than a brush and understands nothing about why you chose it: if it takes in too much, remove the point and tap somewhere more specific, or fall back to painting. “Background” is this mask inverted — the checkbox below.';

const PAINT_HINT =
  'With Paint on, a drag across the picture lays a stroke; the before/after wipe waits until it is off. Erase takes coverage away, and only from what is already there — a stroke painted after an eraser comes back, because strokes apply in the order they were made. Size and Softness are set before a stroke, not after: each stroke keeps the ones it was painted with, which is what lets a soft edge and a hard one live in the same mask.';

const HINT =
  'Feather is the width of the transition, measured against half the picture’s diagonal — so it means the same on a wide frame and on a square crop of it. A linear mask reads 0.5 exactly on its line, and its angle is a compass bearing: 0 covers the top, 90 the right. A radial mask is FULL inside its ellipse and fades outward, so the shape is what is affected rather than the middle of a ramp. Invert applies the layer everywhere the mask is not.';

/**
 * The selected layer's mask and opacity.
 *
 * The procedural shapes are set with NUMBERS — dragging a gradient's line on
 * the picture needs a hit-tested overlay with its own gesture rules, which is a
 * piece of work rather than a control, and "show the mask" plus these sliders
 * already place one accurately. A PAINTED mask is the exception: there is no
 * number that means "here", so it takes the pointer.
 *
 * The maths is `shared/render/mask.ts`.
 */
export default function MaskPanel({
  layer,
  layers,
  onPatch,
  brush,
  onBrush,
  painting,
  onPainting,
  onUndoStroke,
  onClearStrokes,
  subject,
  onClearSubject,
}: {
  layer: AdjustLayer;
  /** The whole stack, for the subjects this layer may take out of itself. */
  layers: readonly AdjustLayer[];
  onPatch: (patch: Partial<Omit<AdjustLayer, 'id'>>) => void;
  /** The settings the NEXT stroke is painted with. */
  brush: { radius: number; hardness: number; erase: boolean };
  onBrush: (patch: Partial<{ radius: number; hardness: number; erase: boolean }>) => void;
  painting: boolean;
  onPainting: (on: boolean) => void;
  onUndoStroke: () => void;
  onClearStrokes: () => void;
  /** Present only for a subject mask — how its segmentation is getting on. */
  subject: { working: boolean; state: string; resolved: boolean } | null;
  onClearSubject: () => void;
}) {
  const mask = layer.mask;
  const kind: string = mask?.kind ?? 'none';
  // The subjects this layer may SUBTRACT — «sauf le sujet», the maintainer's
  // pick (2026-09-23). Offered only where one exists: a control with nothing
  // to choose is a question the author cannot answer.
  const cuts = exceptCandidates(layers, layer.id);
  const exceptOptions = [
    { id: 'none', label: 'Nothing' },
    ...cuts.map((l) => ({ id: l.id, label: cuts.length === 1 ? 'The subject' : layerLabel(l, layers) })),
  ];

  const setKind = (next: string) => {
    // Switching kinds STARTS the new shape fresh rather than carrying numbers
    // across: a radius is not an angle, and a half-translated shape is worse
    // than an obvious default.
    onPatch({ mask: next === 'none' ? null : defaultMask(next as MaskKind) });
  };
  const patchMask = (patch: Partial<Record<string, number>>) => {
    if (!mask) return;
    onPatch({ mask: { ...mask, ...patch } as Mask });
  };

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label={`Mask · ${describeMask(mask)}`}>
        <p>{HINT}</p>
      </SectionLegend>

      {/* Six kinds do not fit one row at an inspector's width — the labels ran
          together as "Radial BrightnessPainted". `columns` is what this control
          has for a choice bigger than a row. */}
      <Segmented columns={3} size="sm" label="Mask" value={kind} onChange={setKind} options={KIND_OPTIONS} />

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
            <Button size="sm" variant="ghost" disabled={!mask.strokes.length} onClick={onUndoStroke}>
              Undo stroke
            </Button>
            <Button size="sm" variant="ghost" disabled={!mask.strokes.length} onClick={onClearStrokes}>
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
            <Button size="sm" variant="ghost" disabled={!mask.points.length} onClick={onClearSubject}>
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

      <RangeSlider
        label="Opacity"
        value={layer.opacity}
        range={{ min: 0, max: 1, step: 0.01, unit: '' }}
        reset={1}
        printed={`${Math.round(layer.opacity * 100)} %`}
        onChange={(v) => onPatch({ opacity: v })}
      />

      {mask && (
        <label className="flex items-center gap-1.5 font-mono text-3xs text-faint">
          <input
            type="checkbox"
            checked={layer.invert}
            onChange={(e) => onPatch({ invert: e.target.checked })}
          />
          invert — apply everywhere the mask is not
        </label>
      )}

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
    </div>
  );
}
