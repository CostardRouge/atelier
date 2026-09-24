import DevelopFold from '../../shared/develop/DevelopFold';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import {
  DEFAULT_POST_VIGNETTE,
  POST_VIGNETTE_RANGES,
  isDefaultPostVignette,
  type PostCropVignette,
} from '../../shared/render/post-vignette';

const HINT =
  'A vignette on the picture AS CROPPED — it follows the crop wherever the crop goes, where the lens correction’s vignetting follows the optics of the whole frame. Amount darkens the edges below zero and lightens them above; Midpoint is how far in it begins, Roundness goes from a rounded rectangle to a circle, Feather how soft it is, and Highlights spares a bright corner — a sky keeps its light under a dark vignette.';

const ROWS: readonly { key: keyof PostCropVignette; label: string }[] = [
  { key: 'amount', label: 'Amount' },
  { key: 'midpoint', label: 'Midpoint' },
  { key: 'roundness', label: 'Roundness' },
  { key: 'feather', label: 'Feather' },
  { key: 'highlights', label: 'Highlights' },
];

/**
 * The post-crop vignette (`shared/render/post-vignette.ts`), Lightroom's
 * Effects vignette — folded by default, like the other finishing sections.
 * Stored as null the moment Amount is 0: the other four shape nothing alone.
 */
export default function VignettePanel({
  value,
  onChange,
}: {
  value: PostCropVignette | null;
  onChange: (vignette: PostCropVignette | null) => void;
}) {
  const v = value ?? { ...DEFAULT_POST_VIGNETTE };
  return (
    <DevelopFold id="vignette" title="Vignette" info={<p>{HINT}</p>} marked={!isDefaultPostVignette(value)} defaultOpen={false}>
      {ROWS.map(({ key, label }) => (
        <RangeSlider
          key={key}
          label={label}
          value={v[key]}
          reset={DEFAULT_POST_VIGNETTE[key]}
          range={{ ...POST_VIGNETTE_RANGES[key], step: 1, unit: '' }}
          printed={key === 'midpoint' || key === 'feather' || key === 'highlights' ? String(v[key]) : undefined}
          onChange={(n) => {
            const next = { ...v, [key]: n };
            onChange(isDefaultPostVignette(next) ? null : next);
          }}
        />
      ))}
      {!isDefaultPostVignette(value) && (
        <button type="button" className={`${developLinkClass} self-start`} onClick={() => onChange(null)}>
          Reset vignette
        </button>
      )}
    </DevelopFold>
  );
}
