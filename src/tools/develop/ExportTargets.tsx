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
  type ExportFormat,
} from '../../shared/develop/export-targets';
import { FieldRow, RangeField, SelectField, SwitchRow, TextField, fieldClass } from '../../shared/ui/Inspector';
import { useBrowserChroma, useFullColourFrom } from '../../shared/media/browser-jpeg';
import { chromaWords } from '../../shared/media/jpeg-chroma';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import { deviceClass } from '../../shared/lib/device-class';

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

const FORMAT_OPTIONS: readonly { id: ExportFormat; label: string }[] = [
  { id: 'jpeg', label: 'JPEG' },
  { id: 'png16', label: 'PNG 16-bit' },
];

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
 * A JPEG target's quality, and what this browser's encoder keeps of the
 * COLOUR at it — measured (`browser-jpeg.ts`), because it is the colour, not
 * the number, that draws blocks in a sky. `Max` is the one value at which
 * Chrome keeps every pixel's colour.
 */
function QualityRow({ quality, onQuality }: { quality: number; onQuality: (quality: number) => void }) {
  const chroma = useBrowserChroma(quality);
  const from = useFullColourFrom();
  const max = quality >= QUALITY_LIMITS.max;
  let hint: string | undefined;
  if (chroma === '4:4:4') hint = `${chroma} · full colour, at several times the weight of 92 %`;
  else if (chroma) {
    const until = from ? ` — full colour from ${Math.round(from * 100)} %` : ' — this browser never writes full colour';
    hint = `${chroma} · ${chromaWords(chroma)} on this browser${until}`;
  }
  return (
    <FieldRow label="Quality" hint={hint} hintShown>
      <RangeField
        label="JPEG quality"
        min={QUALITY_LIMITS.min}
        max={QUALITY_LIMITS.max}
        step={0.01}
        value={quality}
        onChange={onQuality}
        format={(v) => `${Math.round(v * 100)} %`}
      />
      <Button size="sm" aria-pressed={max} variant={max ? 'default' : 'ghost'} onClick={() => onQuality(QUALITY_LIMITS.max)}>
        Max
      </Button>
    </FieldRow>
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
  // A 16-bit picture is read back whole off the GPU: 8 bytes a pixel, and a
  // phone's tab has no room for a 48-megapixel one. The run writes a JPEG
  // there and says so; the panel says it first.
  const phone = deviceClass() === 'constrained';
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
            <FieldRow
              label="Format"
              hint={
                t.format === 'png16'
                  ? phone
                    ? 'a 16-bit file is not made on a phone: this target writes a JPEG here'
                    : '16 bits a channel off the render itself — a master to keep or edit again, several times a JPEG’s weight'
                  : undefined
              }
            >
              <Segmented
                size="sm"
                label="File format"
                value={t.format}
                onChange={(v) => patch(i, v === 'png16' ? { format: 'png16', sharpen: 'off' } : { format: 'jpeg' })}
                options={FORMAT_OPTIONS}
              />
            </FieldRow>
            {t.format === 'jpeg' && <QualityRow quality={t.quality} onQuality={(quality) => patch(i, { quality })} />}
            {t.format === 'jpeg' ? (
              <FieldRow label="Sharpen" hint={t.sharpen === 'off' ? undefined : 'for a screen, after the resize'}>
                <Segmented size="sm" label="Sharpen for screen" value={t.sharpen} onChange={(v) => patch(i, { sharpen: v as OutputSharpen })} options={SHARPEN_OPTIONS} />
              </FieldRow>
            ) : (
              <FieldRow label="Sharpen" hint="a 16-bit master is not sharpened for a screen">
                <span className="font-mono text-2xs text-muted">off</span>
              </FieldRow>
            )}
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
