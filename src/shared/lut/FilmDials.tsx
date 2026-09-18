import { useState } from 'react';
import { signed } from '../develop/develop';
import {
  CURVE_RANGES,
  RESPONSE_RANGES,
  type FilmCurve,
  type FilmResponse,
  type FilmSettings,
} from '../film/emulsion';
import { FILM_STOCKS, filmSettingsFor, filmStock, onStock, type FilmStockId } from '../film/stocks';
import Button from '../ui/Button';
import Segmented from '../ui/Segmented';
import { FieldRow, RangeField, SelectField, ToggleField } from '../ui/Inspector';

interface FilmDialsProps {
  settings: FilmSettings;
  onChange: (settings: FilmSettings) => void;
}

type Channel = 'rgb' | 'r' | 'g' | 'b';

const CHANNELS: readonly { id: Channel; label: string }[] = [
  { id: 'rgb', label: 'All' },
  { id: 'r', label: 'R' },
  { id: 'g', label: 'G' },
  { id: 'b', label: 'B' },
];

const CURVE_DIALS: readonly { key: keyof FilmCurve; label: string; format: (v: number) => string }[] = [
  { key: 'speed', label: 'Speed', format: (v) => `${signed(v, 2).replace(/\.?0+$/, '')} EV` },
  { key: 'gamma', label: 'Contrast', format: (v) => `γ ${v.toFixed(2)}` },
  { key: 'toe', label: 'Toe', format: (v) => `${v.toFixed(2)} EV` },
  { key: 'shoulder', label: 'Shoulder', format: (v) => `${v.toFixed(2)} EV` },
  { key: 'black', label: 'Black', format: (v) => `−${v.toFixed(1)} EV` },
  { key: 'white', label: 'White', format: (v) => `+${v.toFixed(1)} EV` },
];

/**
 * The dials of one film layer: its stock, the emulsion's own numbers, and the
 * three characteristic curves behind an R/G/B picker — a column has no room
 * for eighteen curve sliders at once, and per-channel editing IS the
 * crossover, so the picker is the control, not a hiding place. `All` writes
 * one value onto the three curves and shows the red one's.
 *
 * Every change goes out as whole settings: the host regenerates the cube
 * (cached by settings) and renames the layer to say whether it is still on
 * its stock. Nothing here knows about the stack.
 */
export default function FilmDials({ settings, onChange }: FilmDialsProps) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const stock = filmStock(settings.stock);
  const departed = !onStock(settings);
  const r = settings.response;

  const patch = (over: Partial<FilmResponse>) =>
    onChange({ ...settings, response: { ...r, ...over } });

  const shown: FilmCurve = channel === 'rgb' ? r.curve.r : r.curve[channel];
  const patchCurve = (key: keyof FilmCurve, value: number) => {
    const curve =
      channel === 'rgb'
        ? {
            r: { ...r.curve.r, [key]: value },
            g: { ...r.curve.g, [key]: value },
            b: { ...r.curve.b, [key]: value },
          }
        : { ...r.curve, [channel]: { ...r.curve[channel], [key]: value } };
    patch({ curve });
  };

  const stockOptions = [
    ...FILM_STOCKS.map((s) => ({ id: s.id as string, label: s.name })),
    ...(stock ? [] : [{ id: settings.stock, label: 'A stock this build no longer knows', disabled: true }]),
  ];

  return (
    <div className="flex flex-col gap-2">
      <FieldRow label="Stock" hint={stock?.note}>
        <SelectField
          label="Film stock"
          value={settings.stock}
          onChange={(id) => onChange(filmSettingsFor(id as FilmStockId))}
          options={stockOptions}
        />
      </FieldRow>

      {departed && stock && (
        <FieldRow label="">
          <span className="flex-1 min-w-0 text-xs text-muted">Adjusted from {stock.name}.</span>
          <Button size="sm" onClick={() => onChange(filmSettingsFor(stock.id))} title="Put the stock's own numbers back">
            Back to stock
          </Button>
        </FieldRow>
      )}

      <FieldRow label="Coupling" hint="How much each dye layer also sees its neighbours' light: hue shifts, a little less purity.">
        <RangeField
          label="Coupling"
          {...RESPONSE_RANGES.coupling}
          value={r.coupling}
          onChange={(v) => patch({ coupling: v })}
          format={(v) => `${Math.round(v)}%`}
        />
      </FieldRow>
      <FieldRow label="Rolloff" hint="Coupler inhibition: a saturated colour melts toward neutral instead of clipping to a flat patch.">
        <RangeField
          label="Rolloff"
          {...RESPONSE_RANGES.inhibition}
          value={r.inhibition}
          onChange={(v) => patch({ inhibition: v })}
          format={(v) => `${Math.round(v)}%`}
        />
      </FieldRow>
      <FieldRow label="Dye">
        <RangeField
          label="Dye saturation"
          {...RESPONSE_RANGES.dye}
          value={r.dye}
          onChange={(v) => patch({ dye: v })}
          format={(v) => signed(v)}
        />
      </FieldRow>

      <FieldRow
        label="Print"
        hint={
          r.print
            ? 'A negative printed on paper: the paper sets the final contrast and clips the whites clean.'
            : 'A reversal: the film is the positive, its own shoulder decides the whites.'
        }
      >
        <ToggleField label="Print on paper" checked={r.print} onChange={(print) => patch({ print })}>
          <span className="text-xs text-ink-soft">{r.print ? 'Negative, printed' : 'Reversal'}</span>
        </ToggleField>
      </FieldRow>
      {r.print && (
        <FieldRow label="Paper grade">
          <RangeField
            label="Paper grade"
            {...RESPONSE_RANGES.paperGrade}
            value={r.paperGrade}
            onChange={(v) => patch({ paperGrade: v })}
            format={(v) => v.toFixed(1)}
          />
        </FieldRow>
      )}

      <FieldRow
        label="Curves"
        align="start"
        hint={
          r.mono
            ? 'One layer: the three curves are the same curve.'
            : 'Per channel is the crossover: a lower blue contrast cools the shadows and warms the highlights.'
        }
      >
        <Segmented
          fill
          size="sm"
          label="Curve channel"
          value={channel}
          onChange={setChannel}
          options={CHANNELS}
          className="flex-1 min-w-0"
        />
      </FieldRow>
      {CURVE_DIALS.map(({ key, label, format }) => (
        <FieldRow key={key} label={label}>
          <RangeField
            label={`${label} (${channel === 'rgb' ? 'all channels' : channel.toUpperCase()})`}
            {...CURVE_RANGES[key]}
            value={shown[key]}
            onChange={(v) => patchCurve(key, v)}
            format={format}
          />
        </FieldRow>
      ))}
    </div>
  );
}
