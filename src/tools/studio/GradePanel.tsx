import { useState } from 'react';
import {
  LUT_GROUPS,
  UNGROUPED_LUTS,
} from '../../shared/lut/builtin-luts';
import { OUTPUT_TRANSFORM_OPTIONS } from '../../shared/lut/transfer';
import type { LutStack } from '../../shared/lut/use-lut-stack';

interface GradePanelProps {
  stack: LutStack;
}

const labelClass =
  'font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted';

const selectClass =
  'w-full min-w-0 font-sans text-[0.8rem] px-2 py-[0.4rem] border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent disabled:opacity-60';

/**
 * The grade: a stack of looks applied top to bottom, each with its own
 * strength and an on/off switch. Order matters (a contrast look before or
 * after a film print reads differently), so layers move with ↑/↓ — plain
 * buttons rather than drag-and-drop, which is fiddly in a narrow column.
 *
 * The stack bakes into a single LUT, so the preview, the stills and every
 * export variant grade through exactly one shader pass.
 */
export default function GradePanel({ stack }: GradePanelProps) {
  const [pick, setPick] = useState('');

  const activeCount = stack.layers.filter(
    (l) => l.enabled && l.intensity > 0,
  ).length;

  // Conversion LUTs are authored for a Rec.709 reference display (~gamma 2.4)
  // while a browser shows ~2.2, so a look can read flatter here than intended.
  // Rec.709 and sRGB share primaries — only the curve changes.
  const outputHint =
    OUTPUT_TRANSFORM_OPTIONS.find((o) => o.id === stack.output)?.hint ?? '';

  return (
    <div className="flex flex-col gap-3">
      {/* Add a look */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Add a look</span>
        <div className="flex items-center gap-2">
          <select
            className="flex-1 min-w-0 font-sans text-[0.8rem] px-2 py-[0.4rem] border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent disabled:opacity-60"
            value={pick}
            disabled={stack.busy}
            onChange={(e) => {
              const id = e.target.value;
              setPick('');
              if (id) void stack.addBuiltin(id);
            }}
            aria-label="Add a built-in look"
          >
            <option value="">{stack.busy ? 'Loading…' : 'Built-in…'}</option>
            {UNGROUPED_LUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            {LUT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.luts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void stack.addCustom()}
            className="flex-none px-3 py-[0.4rem] rounded-full border border-line-strong bg-paper text-[0.78rem] font-semibold text-ink cursor-pointer hover:border-accent"
            title="Load a .cube file from disk"
          >
            .cube…
          </button>
        </div>
      </div>

      {stack.error && (
        <p className="m-0 text-[0.78rem] text-[#9a3a23]">{stack.error}</p>
      )}

      {/* The stack */}
      {stack.layers.length === 0 ? (
        <p className="m-0 text-[0.8rem] text-muted leading-relaxed">
          No look yet — the clip grades through untouched. Add one or several;
          they apply in order, top to bottom.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>
            Stack · {stack.layers.length}
            {activeCount !== stack.layers.length && ` · ${activeCount} active`}
          </span>
          {stack.layers.map((layer, i) => (
            <div
              key={layer.id}
              className={`flex flex-col gap-1.5 border rounded-paper px-2.5 py-2 transition-colors ${
                layer.enabled
                  ? 'border-line bg-paper'
                  : 'border-line bg-transparent opacity-55'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => stack.setEnabled(layer.id, !layer.enabled)}
                  aria-pressed={layer.enabled}
                  className="flex-none w-5 text-center text-[0.8rem] text-ink-soft cursor-pointer bg-transparent border-0 hover:text-accent"
                  title={layer.enabled ? 'Bypass this look' : 'Enable this look'}
                  aria-label={layer.enabled ? 'Bypass look' : 'Enable look'}
                >
                  {layer.enabled ? '◉' : '○'}
                </button>
                <span
                  className="flex-1 min-w-0 truncate text-[0.82rem] font-semibold"
                  title={layer.name}
                >
                  {layer.name}
                </span>
                <span className="flex-none font-mono text-[0.66rem] tabular-nums text-faint">
                  {Math.round(layer.intensity * 100)}%
                </span>
                <div className="flex-none flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => stack.move(layer.id, -1)}
                    disabled={i === 0}
                    className="w-5 h-5 grid place-items-center rounded border border-line bg-transparent text-ink-soft text-[0.7rem] cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-30 disabled:cursor-default"
                    aria-label="Move look up"
                    title="Apply earlier"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => stack.move(layer.id, 1)}
                    disabled={i === stack.layers.length - 1}
                    className="w-5 h-5 grid place-items-center rounded border border-line bg-transparent text-ink-soft text-[0.7rem] cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-30 disabled:cursor-default"
                    aria-label="Move look down"
                    title="Apply later"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => stack.remove(layer.id)}
                    className="w-5 h-5 grid place-items-center rounded-full border border-line bg-transparent text-faint text-[0.75rem] cursor-pointer hover:text-[#9a3a23] hover:border-[#e3b8a9]"
                    aria-label="Remove look"
                    title="Remove from the stack"
                  >
                    ×
                  </button>
                </div>
              </div>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0}
                max={3}
                step={0.05}
                value={layer.intensity}
                disabled={!layer.enabled}
                onChange={(e) =>
                  stack.setIntensity(layer.id, Number(e.target.value))
                }
                aria-label={`${layer.name} strength`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Output transform — the delivery stage, always last */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-line">
        <span className={labelClass}>Output transform</span>
        <select
          className={selectClass}
          value={stack.output}
          onChange={(e) =>
            stack.setOutput(
              e.target.value as (typeof OUTPUT_TRANSFORM_OPTIONS)[number]['id'],
            )
          }
          aria-label="Output transform"
        >
          {OUTPUT_TRANSFORM_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="m-0 text-[0.72rem] text-faint leading-relaxed">
          {outputHint}
        </p>
      </div>

      <p className="m-0 text-[0.72rem] text-faint leading-relaxed">
        Looks apply top to bottom and bake into one LUT — the preview, the
        stills and every export variant grade identically. Above 100% a look
        extrapolates past what it was authored for.
      </p>
    </div>
  );
}
