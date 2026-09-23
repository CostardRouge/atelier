import { useState } from 'react';
import SectionLegend from '../ui/SectionLegend';
import Segmented from '../ui/Segmented';
import { developLinkClass } from './develop-classes';
import { RangeSlider } from './DevelopSliders';
import {
  BAND_CENTRES,
  MIXER_BANDS,
  MIXER_CHANNELS,
  bandLabel,
  isDefaultMixer,
  withMixerValue,
  withoutMixerChannel,
  type ColourMixer,
  type MixerChannel,
} from './mixer';

const CHANNEL_LABELS: Readonly<Record<MixerChannel, string>> = {
  hue: 'Hue',
  saturation: 'Saturation',
  luminance: 'Luminance',
};

const HINT =
  'Eight bands of colour, each moved on its own — darken a blue sky, calm a green lawn, warm a skin — while everything else stays. A grey is never touched, a hue shift keeps its light, and a band fades into its neighbours so no colour falls between two.';

/**
 * The colour mixer (`mixer.ts`), Lightroom's HSL panel: one channel at a
 * time — Hue, Saturation or Luminance — over the eight bands, the way
 * Lightroom and Capture One both lay it out, because the eight sliders of one
 * channel are what is compared. A channel with anything in it is marked in
 * the switch, so a move made under another tab is never hidden.
 */
export default function DevelopMixer({
  value,
  onChange,
}: {
  value: ColourMixer | null | undefined;
  onChange: (mixer: ColourMixer | null) => void;
}) {
  const [channel, setChannel] = useState<MixerChannel>('hue');
  const used = (c: MixerChannel) => Boolean(value?.[c].some((v) => v !== 0));
  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label="Colour mixer">
        <p>{HINT}</p>
      </SectionLegend>
      <Segmented
        fill
        size="sm"
        label="Mixer channel"
        value={channel}
        onChange={setChannel}
        options={MIXER_CHANNELS.map((c) => ({
          id: c,
          label: used(c) ? `${CHANNEL_LABELS[c]} •` : CHANNEL_LABELS[c],
          title: used(c) ? `${CHANNEL_LABELS[c]} — moved` : CHANNEL_LABELS[c],
        }))}
      />
      {MIXER_BANDS.map((band, i) => (
        <RangeSlider
          key={band}
          label={bandLabel(band)}
          swatch={`hsl(${BAND_CENTRES[band]} 75% 52%)`}
          value={value?.[channel][i] ?? 0}
          range={{ min: -100, max: 100, step: 1, unit: '' }}
          onChange={(v) => onChange(withMixerValue(value, channel, band, v))}
        />
      ))}
      {!isDefaultMixer(value) && (
        <span className="flex gap-3">
          {used(channel) && (
            <button type="button" className={developLinkClass} onClick={() => onChange(withoutMixerChannel(value, channel))}>
              Reset {CHANNEL_LABELS[channel].toLowerCase()}
            </button>
          )}
          <button type="button" className={developLinkClass} onClick={() => onChange(null)}>
            Reset mixer
          </button>
        </span>
      )}
    </div>
  );
}
