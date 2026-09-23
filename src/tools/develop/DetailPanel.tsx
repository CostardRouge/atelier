import DevelopFold from '../../shared/develop/DevelopFold';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import { DEFAULT_DETAIL, DETAIL_RANGES, describeDetail, isDefaultDetail, type DetailSettings } from '../../shared/render/detail';

const NOISE_HINT =
  'Luminance smooths the grain of a high ISO while keeping every edge — a pixel is averaged only with neighbours of a similar brightness, so a wall goes quiet and a hairline stays a hairline. Colour removes the coloured speckle on its own; it can go much further than luminance without softening anything the eye reads, because edges live in the luminance. Both run on the picture BEFORE the develop, where the noise is what the sensor left rather than what a lift made of it.';

const FRINGE_HINT =
  'A lens leaves a purple edge on high-contrast subjects — a branch against the sky, a chrome rim. Defringe pulls the purple toward neutral only where the brightness changes steeply; a purple wall away from any edge is left alone.';

const SHARPEN_HINT =
  'An unsharp mask on the luminance, applied last so nothing resamples it afterwards: Amount is how much the edges are steepened, Radius how wide an edge counts as one. One pixel suits a sharp file; a soft one wants a little more. Detail holds back the strong edges, where a halo is born, while the fine texture keeps its gain — 100 is the plain mask. Masking sharpens only where the picture changes steeply, so a sky’s noise and a cheek are left alone; Show the mask paints white where it sharpens. No hue moves and no coloured halo is invented, which is what applying it to the luminance alone buys.';

const SCALE_NOTE =
  'A radius is a number of pixels of the FILE. The stage shows the picture at a fraction of its density and scales the kernels to match, which is a fair preview and not the truth: judge detail in the loupe, at one pixel per pixel.';

type Key = keyof DetailSettings;

/** The keys this TAB owns — presence shares the record and is drawn on the Adjust tab. */
const DETAIL_TAB_KEYS: readonly Key[] = [
  'luminance',
  'colour',
  'defringe',
  'sharpen',
  'sharpenRadius',
  'sharpenDetail',
  'sharpenMasking',
];

const PRESENCE_HINT =
  'Texture is local contrast at a small scale — pores, bark, fabric — and smooths them below zero. Clarity is the same at a large scale, on the midtones only, so shapes and clouds gain body while the ends are spared. Dehaze reads the haze from the darkest channel around each place and takes it out (or adds one below zero); a bright sky darkens with it, as haze removal does. All three look around the pixel, so their scale is a share of the picture — the stage and the file see the same thing.';

const PRESENCE: readonly { key: Key; label: string }[] = [
  { key: 'texture', label: 'Texture' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'dehaze', label: 'Dehaze' },
];

/**
 * Presence — texture, clarity, dehaze — drawn on the ADJUST tab, where a
 * Lightroom hand looks for them, over the detail record they share
 * (`shared/render/presence.ts`).
 */
export function PresencePanel({
  value,
  onChange,
}: {
  value: DetailSettings | null;
  onChange: (detail: DetailSettings | null) => void;
}) {
  const detail: DetailSettings = value ?? { ...DEFAULT_DETAIL };
  return (
    <DevelopFold
      id="presence"
      title="Presence"
      info={<p>{PRESENCE_HINT}</p>}
      marked={PRESENCE.some(({ key }) => detail[key] !== 0)}
    >
      {PRESENCE.map(({ key, label }) => (
        <RangeSlider
          key={key}
          label={label}
          value={detail[key]}
          range={{ ...DETAIL_RANGES[key], unit: '' }}
          onChange={(v) => {
            const next: DetailSettings = { ...detail, [key]: v };
            onChange(isDefaultDetail(next) ? null : next);
          }}
        />
      ))}
    </DevelopFold>
  );
}

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
  maskView = false,
  onMaskView,
}: {
  value: DetailSettings | null;
  onChange: (detail: DetailSettings | null) => void;
  /** The stage paints the sharpen's Masking weight instead of the picture. */
  maskView?: boolean;
  onMaskView?: (on: boolean) => void;
}) {
  const detail: DetailSettings = value ?? { ...DEFAULT_DETAIL };
  const write = (key: Key, v: number) => {
    const next: DetailSettings = { ...detail, [key]: v };
    // Stored as null the moment it does nothing — a radius alone is not an operation.
    onChange(isDefaultDetail(next) ? null : next);
  };
  const tabOnly: DetailSettings = { ...detail, texture: 0, clarity: 0, dehaze: 0 };
  const tabTouched = !isDefaultDetail(tabOnly);
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
      <DevelopFold
        id="noise"
        title="Noise"
        info={
          <>
            <p>{NOISE_HINT}</p>
            <p>{SCALE_NOTE}</p>
          </>
        }
        marked={detail.luminance !== 0 || detail.colour !== 0}
      >
        {NOISE.map((k) => slider(k.key, k.label))}
      </DevelopFold>
      {/* One slider: the same header, no fold. */}
      <DevelopFold id="fringing" title="Fringing" info={<p>{FRINGE_HINT}</p>} foldable={false}>
        {slider('defringe', 'Defringe')}
      </DevelopFold>
      <DevelopFold id="sharpen" title="Sharpen" info={<p>{SHARPEN_HINT}</p>} marked={detail.sharpen !== 0}>
        {slider('sharpen', 'Amount')}
        {slider('sharpenRadius', 'Radius', DEFAULT_DETAIL.sharpenRadius)}
        {slider('sharpenDetail', 'Detail', DEFAULT_DETAIL.sharpenDetail)}
        {slider('sharpenMasking', 'Masking')}
        {onMaskView && (
          <button
            type="button"
            aria-pressed={maskView}
            className={`${developLinkClass} self-start ${maskView ? 'text-accent-ink' : ''}`}
            title="Paint the picture white where it is sharpened and black where it is left alone — Lightroom's Alt-drag on Masking"
            onClick={() => onMaskView(!maskView)}
          >
            {maskView ? 'Hide the mask' : 'Show the mask'}
          </button>
        )}
      </DevelopFold>
      {tabTouched && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-faint truncate" title={describeDetail(tabOnly)}>
            {describeDetail(tabOnly)}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className={developLinkClass}
            // This tab's keys only: texture, clarity and dehaze belong to the
            // Adjust tab and a Reset here must not reach them.
            onClick={() => {
              const next: DetailSettings = { ...detail };
              for (const k of DETAIL_TAB_KEYS) next[k] = DEFAULT_DETAIL[k];
              onChange(isDefaultDetail(next) ? null : next);
            }}
          >
            Reset
          </button>
        </div>
      )}
    </>
  );
}
