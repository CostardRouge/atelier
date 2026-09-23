import { useState } from 'react';
import DevelopFold from './DevelopFold';
import Segmented from '../ui/Segmented';
import { developLinkClass } from './develop-classes';
import { RangeSlider } from './DevelopSliders';
import {
  BAND_CENTRES,
  MIXER_BANDS,
  MIXER_CHANNELS,
  bandLabel,
  isDefaultMixer,
  straightMono,
  withMixerValue,
  withMonoValue,
  withoutMixerChannel,
  type ColourMixer,
  type MixerChannel,
  type MonoMix,
} from './mixer';

const CHANNEL_LABELS: Readonly<Record<MixerChannel, string>> = {
  hue: 'Hue',
  saturation: 'Saturation',
  luminance: 'Luminance',
};

const MONO_HINT =
  'Black and white, and how light each colour becomes in grey — the red, orange or yellow filter a film photographer screwed on, band by band: a blue sky pulled down goes dark behind white clouds, an orange raised lifts a face. A grey stays its own grey. The colour mixer is kept, not applied, and comes back with Colour; the grading wheels still tint the grey, which is how a split tone is made. V switches the treatment.';

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
  mono,
  onMono,
}: {
  value: ColourMixer | null | undefined;
  onChange: (mixer: ColourMixer | null) => void;
  /** The black-and-white treatment (`MonoMix`), null for colour. */
  mono: MonoMix | null | undefined;
  onMono: (mono: MonoMix | null) => void;
}) {
  const [channel, setChannel] = useState<MixerChannel>('hue');
  const used = (c: MixerChannel) => Boolean(value?.[c].some((v) => v !== 0));
  // Lightroom's Treatment, at the head of the one section it changes: in
  // black and white the same eight bands become eight LIGHTS in grey.
  const treatment = (
    <Segmented
      fill
      size="sm"
      label="Treatment"
      value={mono ? 'mono' : 'colour'}
      onChange={(t) => onMono(t === 'mono' ? straightMono() : null)}
      options={[
        { id: 'colour', label: 'Colour', title: 'Colour (V)' },
        { id: 'mono', label: 'B&W', title: 'Black and white (V)' },
      ]}
    />
  );
  if (mono) {
    const mixed = mono.mix.some((v) => v !== 0);
    return (
      <DevelopFold id="mixer" title="B&W mix" info={<p>{MONO_HINT}</p>} marked defaultOpen={false}>
        {treatment}
        {MIXER_BANDS.map((band, i) => (
          <RangeSlider
            key={band}
            label={bandLabel(band)}
            swatch={`hsl(${BAND_CENTRES[band]} 75% 52%)`}
            value={mono.mix[i]}
            range={{ min: -100, max: 100, step: 1, unit: '' }}
            onChange={(v) => onMono(withMonoValue(mono, band, v))}
          />
        ))}
        {mixed && (
          <button type="button" className={`${developLinkClass} self-start`} onClick={() => onMono(straightMono())}>
            Reset mix
          </button>
        )}
      </DevelopFold>
    );
  }
  return (
    <DevelopFold id="mixer" title="Colour mixer" info={<p>{HINT}</p>} marked={!isDefaultMixer(value)} defaultOpen={false}>
      {treatment}
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
    </DevelopFold>
  );
}
