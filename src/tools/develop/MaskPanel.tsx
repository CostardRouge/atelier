import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import {
  defaultMask,
  describeMask,
  type Mask,
  type MaskKind,
} from '../../shared/render/mask';
import type { AdjustLayer } from '../../shared/develop/layer';

const KIND_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'none', label: 'Whole' },
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'luma', label: 'Brightness' },
];

const HINT =
  'Feather is the width of the transition, measured against half the picture’s diagonal — so it means the same on a wide frame and on a square crop of it. A linear mask reads 0.5 exactly on its line, and its angle is a compass bearing: 0 covers the top, 90 the right. A radial mask is FULL inside its ellipse and fades outward, so the shape is what is affected rather than the middle of a ramp. Invert applies the layer everywhere the mask is not.';

/**
 * The selected layer's mask and opacity.
 *
 * Numbers rather than handles on the stage. Dragging the shape on the picture
 * is the obvious next step and is not here: it needs a hit-tested overlay with
 * its own gesture rules, which is a piece of work rather than a control, and
 * "show the mask" plus these sliders already place a gradient accurately. The
 * maths is `shared/render/mask.ts`.
 */
export default function MaskPanel({
  layer,
  onPatch,
}: {
  layer: AdjustLayer;
  onPatch: (patch: Partial<Omit<AdjustLayer, 'id'>>) => void;
}) {
  const mask = layer.mask;
  const kind: string = mask?.kind ?? 'none';

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

      <Segmented fill size="sm" label="Mask" value={kind} onChange={setKind} options={KIND_OPTIONS} />

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
    </div>
  );
}
