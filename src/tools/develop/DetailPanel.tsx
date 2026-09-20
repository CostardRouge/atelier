import SectionLegend from '../../shared/ui/SectionLegend';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import { DEFAULT_DETAIL, DETAIL_RANGES, describeDetail, isDefaultDetail, type DetailSettings } from '../../shared/render/detail';

const NOISE_HINT =
  'Luminance smooths the grain of a high ISO while keeping every edge — a pixel is averaged only with neighbours of a similar brightness, so a wall goes quiet and a hairline stays a hairline. Colour removes the coloured speckle on its own; it can go much further than luminance without softening anything the eye reads, because edges live in the luminance. Both run on the picture BEFORE the develop, where the noise is what the sensor left rather than what a lift made of it.';

const FRINGE_HINT =
  'A lens leaves a purple edge on high-contrast subjects — a branch against the sky, a chrome rim. Defringe pulls the purple toward neutral only where the brightness changes steeply; a purple wall away from any edge is left alone.';

const SHARPEN_HINT =
  'An unsharp mask on the luminance, applied last so nothing resamples it afterwards: Amount is how much the edges are steepened, Radius how wide an edge counts as one. One pixel suits a sharp file; a soft one wants a little more. No hue moves and no coloured halo is invented, which is what applying it to the luminance alone buys.';

const SCALE_NOTE =
  'A radius is a number of pixels of the FILE. The stage shows the picture at a fraction of its density and scales the kernels to match, which is a fair preview and not the truth: judge detail in the loupe, at one pixel per pixel.';

type Key = keyof DetailSettings;

const NOISE: readonly { key: Key; label: string }[] = [
  { key: 'luminance', label: 'Luminance' },
  { key: 'colour', label: 'Colour' },
];

/**
 * Detail — denoise, defringe, sharpen — on its own tab: what is next to a
 * pixel, rather than what a pixel is. The maths is `shared/render/detail.ts`.
 */
export default function DetailPanel({
  value,
  onChange,
}: {
  value: DetailSettings | null;
  onChange: (detail: DetailSettings | null) => void;
}) {
  const detail: DetailSettings = value ?? { ...DEFAULT_DETAIL };
  const write = (key: Key, v: number) => {
    const next: DetailSettings = { ...detail, [key]: v };
    // Stored as null the moment it does nothing — a radius alone is not an operation.
    onChange(isDefaultDetail(next) ? null : next);
  };
  const slider = (key: Key, label: string, reset = 0) => (
    <RangeSlider
      key={key}
      label={label}
      value={detail[key]}
      range={{ ...DETAIL_RANGES[key], unit: key === 'sharpenRadius' ? ' px' : '' }}
      reset={reset}
      printed={key === 'sharpenRadius' ? `${detail[key].toFixed(1)} px` : undefined}
      onChange={(v) => write(key, v)}
    />
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <SectionLegend label="Noise">
          <p>{NOISE_HINT}</p>
          <p>{SCALE_NOTE}</p>
        </SectionLegend>
        {NOISE.map((k) => slider(k.key, k.label))}
      </div>
      <div className="flex flex-col gap-2">
        <SectionLegend label="Fringing">
          <p>{FRINGE_HINT}</p>
        </SectionLegend>
        {slider('defringe', 'Defringe')}
      </div>
      <div className="flex flex-col gap-2">
        <SectionLegend label="Sharpen">
          <p>{SHARPEN_HINT}</p>
        </SectionLegend>
        {slider('sharpen', 'Amount')}
        {slider('sharpenRadius', 'Radius', DEFAULT_DETAIL.sharpenRadius)}
      </div>
      {!isDefaultDetail(value) && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-faint truncate" title={describeDetail(value)}>
            {describeDetail(value)}
          </span>
          <span className="flex-1" />
          <button type="button" className={developLinkClass} onClick={() => onChange(null)}>
            Reset
          </button>
        </div>
      )}
    </>
  );
}
