import { useEffect, useState } from 'react';
import {
  MAX_TARGETS,
  OUTPUT_SHARPEN_LEVELS,
  QUALITY_LIMITS,
  SIZE_LIMITS,
  TARGET_PRESETS,
  convertSize,
  readSize,
  targetFolder,
  type ExportTarget,
  type OutputSharpen,
  type SizeMode,
} from '../../shared/develop/export-targets';
import { FieldRow, RangeField, SelectField, SwitchRow, TextField, fieldClass } from '../../shared/ui/Inspector';
import IconButton from '../../shared/ui/IconButton';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';

const SIZE_MODES: readonly { id: 'full' | SizeMode; label: string }[] = [
  { id: 'full', label: 'Full size' },
  { id: 'long', label: 'Long edge' },
  { id: 'short', label: 'Short edge' },
  { id: 'megapixels', label: 'Megapixels' },
  { id: 'percent', label: 'Percentage' },
];

const UNIT: Record<SizeMode, string> = { long: 'px', short: 'px', megapixels: 'MP', percent: '%' };

const SHARPEN_OPTIONS: readonly { id: OutputSharpen; label: string }[] = OUTPUT_SHARPEN_LEVELS.map((id) => ({
  id,
  label: id === 'off' ? 'Off' : id[0].toUpperCase() + id.slice(1),
}));

/**
 * A size's number, typed and COMMITTED on blur or Enter: clamped per
 * keystroke, "2048" would pass through 2, 20 and 204 and be pushed up to the
 * minimum on the way.
 */
function SizeValue({
  mode,
  value,
  onCommit,
}: {
  mode: SizeMode;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const read = readSize({ mode, value: Number(text) });
    if (read) onCommit(read.value);
    else setText(String(value));
  };
  const { min, max } = SIZE_LIMITS[mode];
  return (
    <span className="relative flex-none w-24 inline-flex">
      <input
        type="number"
        inputMode="decimal"
        aria-label={`Size in ${UNIT[mode]}`}
        min={min}
        max={max}
        step={mode === 'megapixels' ? 0.1 : 1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className={`${fieldClass} font-mono tabular-nums pr-9`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted" aria-hidden="true">
        {UNIT[mode]}
      </span>
    </span>
  );
}

/**
 * The run's TARGETS (audit item 28): the first writes into the folder chosen
 * at the click, each other one into a sub-folder named after it, every file
 * keeping its picture's own name. Each picture is rendered once and cut to
 * every target.
 */
export default function ExportTargets({
  targets,
  onTargets,
}: {
  targets: readonly ExportTarget[];
  onTargets: (targets: ExportTarget[]) => void;
}) {
  const patch = (i: number, change: Partial<ExportTarget>) =>
    onTargets(targets.map((t, k) => (k === i ? { ...t, ...change } : t)));
  const names = new Set<string>();
  return (
    <div className="flex flex-col gap-3">
      {targets.map((t, i) => {
        const folder = targetFolder(t.name, i);
        const clash = i > 0 && names.has(folder.toLowerCase());
        if (i > 0) names.add(folder.toLowerCase());
        return (
          <div key={i} className={`flex flex-col gap-1.5 ${i > 0 ? 'border-t border-line pt-3' : ''}`}>
            <div className="flex items-center gap-2">
              {i === 0 ? (
                <span className="flex-1 font-mono text-2xs text-muted">
                  {targets.length > 1 ? 'The chosen folder' : 'Where you choose, at the click'}
                </span>
              ) : (
                <>
                  <span className="font-mono text-3xs text-faint">into</span>
                  <span className="flex-1 min-w-0">
                    <TextField label="Sub-folder" value={t.name} placeholder={`Target ${i + 1}`} onChange={(name) => patch(i, { name })} />
                  </span>
                  <span className="font-mono text-3xs text-faint">/</span>
                  <IconButton size="sm" label={`Remove the ${folder} target`} onClick={() => onTargets(targets.filter((_, k) => k !== i))}>
                    {Icons.trash}
                  </IconButton>
                </>
              )}
            </div>
            {clash && (
              <span className="font-mono text-3xs text-danger">two targets write into {folder}/ — the second numbers its files</span>
            )}
            <FieldRow label="Size">
              <div className="flex flex-1 min-w-0 items-center gap-1.5">
                <SelectField
                  label="Size"
                  value={t.size ? t.size.mode : 'full'}
                  options={SIZE_MODES}
                  onChange={(mode) => patch(i, { size: mode === 'full' ? null : convertSize(t.size, mode) })}
                />
                {t.size && <SizeValue mode={t.size.mode} value={t.size.value} onCommit={(value) => patch(i, { size: { mode: t.size!.mode, value } })} />}
              </div>
            </FieldRow>
            <FieldRow label="Quality">
              <RangeField
                label="JPEG quality"
                min={QUALITY_LIMITS.min}
                max={QUALITY_LIMITS.max}
                step={0.01}
                value={t.quality}
                onChange={(q) => patch(i, { quality: q })}
                format={(v) => `${Math.round(v * 100)} %`}
              />
            </FieldRow>
            <FieldRow label="Sharpen" hint={t.sharpen === 'off' ? undefined : 'for a screen, after the resize'}>
              <Segmented size="sm" label="Sharpen for screen" value={t.sharpen} onChange={(v) => patch(i, { sharpen: v as OutputSharpen })} options={SHARPEN_OPTIONS} />
            </FieldRow>
            <SwitchRow
              label="Watermark"
              name={`Watermark ${i === 0 ? 'the chosen folder' : folder}`}
              checked={t.watermark}
              onChange={(on) => patch(i, { watermark: on })}
            />
          </div>
        );
      })}
      {targets.length < MAX_TARGETS && (
        <FieldRow label="Also write">
          <SelectField
            label="Add a target"
            value="none"
            options={[{ id: 'none', label: 'Add a target…' }, ...TARGET_PRESETS.map((p) => ({ id: p.id, label: p.label }))]}
            onChange={(id) => {
              const preset = TARGET_PRESETS.find((p) => p.id === id);
              if (!preset) return;
              // A second target of one name would share its sub-folder.
              const taken = new Set(targets.slice(1).map((t, k) => targetFolder(t.name, k + 1).toLowerCase()));
              let name = preset.target.name;
              for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${preset.target.name} ${n}`;
              onTargets([...targets, { ...preset.target, name }]);
            }}
          />
        </FieldRow>
      )}
    </div>
  );
}
