import SectionLegend from '../../shared/ui/SectionLegend';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import { DEFAULT_LENS, isDefaultLens, type LensCorrection } from '../../shared/render/lens';

const HINT =
  'A wide lens bows straight lines outwards (barrel) and a long one pinches them in (pincushion); Distortion takes that back out, and Secondary is the one a “moustache” curve needs, where the middle of the frame bends the other way from the corners. Fringing scales red and blue against green, which is what removes the coloured edges on high-contrast subjects near the corners. Vignetting lifts the corners a lens darkened, and Falls off says how much of the middle stays untouched. All of it is radial — measured from the centre of the frame — so it runs BEFORE the perspective correction, which needs straight lines to make parallel.';

const NO_PROFILES =
  'There are no lens profiles here, on purpose. A profile is measured calibration data for one body and one lens; numbers invented to fill the gap would look authoritative and be wrong. These sliders correct by eye against a straight edge — a window frame, a horizon — and work on any lens. Note that a JPEG out of a drone or a phone is usually dewarped already, so it needs none of this; a RAW is not.';

const KEYS = [
  { key: 'distortion', label: 'Distortion', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'distortion2', label: 'Secondary', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'chromaRed', label: 'Fringing, red', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'chromaBlue', label: 'Fringing, blue', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'vignette', label: 'Vignetting', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'vignetteMidpoint', label: 'Falls off', min: 0, max: 100, step: 1, reset: 50 },
] as const;

/**
 * The lens correction — distortion, fringing and vignetting.
 *
 * It sits beside the perspective on the Crop tab: both are about the SHAPE of
 * the picture rather than its light, and the order between them matters and is
 * easier to hold when they are together. The maths is `shared/render/lens.ts`.
 */
export default function LensPanel({
  value,
  onChange,
}: {
  value: LensCorrection | null;
  onChange: (lens: LensCorrection | null) => void;
}) {
  const lens: LensCorrection = value ?? { ...DEFAULT_LENS };
  const write = (key: keyof LensCorrection, v: number) => {
    const next: LensCorrection = { ...lens, [key]: v };
    // Stored as null the moment it does nothing — a midpoint on its own only
    // says WHERE a lift would bite, so it is not a correction.
    onChange(isDefaultLens(next) ? null : next);
  };

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label="Lens">
        <p>{HINT}</p>
        <p>{NO_PROFILES}</p>
      </SectionLegend>
      {KEYS.map((k) => (
        <RangeSlider
          key={k.key}
          label={k.label}
          value={lens[k.key]}
          range={{ min: k.min, max: k.max, step: k.step, unit: '' }}
          reset={k.reset}
          onChange={(v) => write(k.key, v)}
        />
      ))}
      {!isDefaultLens(value) && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-faint">
            corrected before the perspective, and before the crop
          </span>
          <span className="flex-1" />
          <button type="button" className={developLinkClass} onClick={() => onChange(null)}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
