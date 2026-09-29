import { FieldRow, RangeField, SelectField, swatchClass } from '../ui/Inspector';
import { KNOCKOUT_MODES, switchKnockout, type Knockout, type KnockoutMode } from './knockout';

interface Props {
  value: Knockout | undefined;
  onChange: (next: Knockout | undefined) => void;
  /** Names the controls for a screen reader when several lines each have their own ("Line 2"). */
  label?: string;
}

const OPTIONS: readonly { id: KnockoutMode | 'off'; label: string }[] = [
  { id: 'off', label: 'Off' },
  ...KNOCKOUT_MODES.map((m) => ({ id: m.id, label: m.label })),
];

/**
 * A text's mask (`knockout.ts`): off, the picture read through the letters,
 * or the letters cut out of it — then the wash's colour and strength, or the
 * ground a cut shows. One set of rows for the Trips line and the Studio
 * element alike, so the two say the same words for the same thing.
 */
export default function KnockoutRows({ value, onChange, label }: Props) {
  const name = (what: string) => (label ? `${label} ${what}` : what[0].toUpperCase() + what.slice(1));
  const mode = value?.mode ?? 'off';
  return (
    <>
      <FieldRow label="Mask" hint={KNOCKOUT_MODES.find((m) => m.id === mode)?.hint}>
        <SelectField
          label={name('mask')}
          value={mode}
          options={OPTIONS}
          onChange={(next) => onChange(switchKnockout(value, next))}
        />
      </FieldRow>
      {value && (
        <FieldRow label={value.mode === 'wash' ? 'Wash' : 'Ground'}>
          <input
            type="color"
            aria-label={name(value.mode === 'wash' ? 'wash colour' : 'ground colour')}
            value={value.color}
            onChange={(e) => onChange({ ...value, color: e.target.value })}
            className={swatchClass}
          />
        </FieldRow>
      )}
      {value?.mode === 'wash' && (
        <FieldRow label="Strength">
          <RangeField
            label={name('wash strength')}
            min={0.2}
            max={1}
            step={0.01}
            value={value.alpha}
            onChange={(alpha) => onChange({ ...value, alpha })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
      )}
    </>
  );
}
